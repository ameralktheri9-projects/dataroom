import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { findLinkBySlug, resolveAccess } from "@/lib/access/resolve";
import { linkContents } from "@/lib/access/scope";
import { currentVisit } from "@/lib/access/visit";

// Page-time beacons from the viewer (FR-50). Seconds per page are capped per beacon so a
// tampered client cannot inflate analytics.
const body = z.object({
  versionId: z.string().uuid(),
  pages: z.record(z.string().regex(/^\d{1,5}$/), z.number().int().min(0).max(60)),
});

export async function POST(req: Request, ctx: RouteContext<"/api/v/[slug]/track">) {
  const { slug } = await ctx.params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });

  const link = await findLinkBySlug(slug);
  if (!link) return new NextResponse(null, { status: 404 });
  const access = await resolveAccess(link);
  if (access.step !== "granted") return new NextResponse(null, { status: 403 });
  const visit = await currentVisit(access.session);
  if (!visit) return new NextResponse(null, { status: 403 });

  const contents = await linkContents(link.id);
  const doc = contents.documents.find((d) => d.version.id === parsed.data.versionId);
  if (!doc) return new NextResponse(null, { status: 403 });
  const maxPage = doc.version.pageCount ?? 10_000;

  const rows = Object.entries(parsed.data.pages)
    .map(([p, s]) => ({ page: Number(p), seconds: s }))
    .filter((r) => r.page >= 1 && r.page <= maxPage && r.seconds > 0);
  if (!rows.length) return new NextResponse(null, { status: 204 });

  const db = await getDb();
  for (const r of rows) {
    await db
      .insert(schema.viewEvents)
      .values({ visitId: visit.id, documentVersionId: doc.version.id, pageNumber: r.page, secondsViewed: r.seconds })
      .onConflictDoUpdate({
        target: [schema.viewEvents.visitId, schema.viewEvents.documentVersionId, schema.viewEvents.pageNumber],
        set: { secondsViewed: sql`${schema.viewEvents.secondsViewed} + ${r.seconds}`, updatedAt: new Date() },
      });
  }
  await db.update(schema.visits).set({ endedAt: new Date() }).where(eq(schema.visits.id, visit.id));
  if (access.visitor) await db.update(schema.visitors).set({ lastSeenAt: new Date() }).where(eq(schema.visitors.id, access.visitor.id));
  return new NextResponse(null, { status: 204 });
}
