import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { metaFromHeaders } from "@/lib/request";
import { findLinkBySlug, resolveAccess } from "@/lib/access/resolve";
import { writeVisitorSession } from "@/lib/access/visitor-session";
import { currentVisit } from "@/lib/access/visit";
import { notifyLinkOpened } from "@/lib/notify";

// Starts a visit once all gates are passed (FR-50), then sends the visitor on.
// A route handler rather than the page itself, because only handlers and actions may set cookies.
export async function GET(req: Request, ctx: RouteContext<"/v/[slug]/enter">) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  const nextParam = url.searchParams.get("next");
  const next = nextParam && nextParam.startsWith(`/v/${slug}`) ? nextParam : `/v/${slug}`;

  const link = await findLinkBySlug(slug);
  if (!link) return NextResponse.redirect(new URL(`/v/${slug}`, req.url));
  const { step, session, visitor } = await resolveAccess(link);
  if (step !== "granted") return NextResponse.redirect(new URL(`/v/${slug}`, req.url));

  if (!(await currentVisit(session))) {
    const meta = metaFromHeaders(req.headers);
    const db = await getDb();
    const [visit] = await db
      .insert(schema.visits)
      .values({
        visitorId: visitor?.id ?? null,
        linkId: link.id,
        ip: meta.ip,
        country: meta.country,
        device: meta.device,
        userAgent: meta.userAgent?.slice(0, 500),
      })
      .returning();
    await writeVisitorSession({ ...session, visitorId: visitor?.id ?? null, visitId: visit.id });
    if (visitor) await db.update(schema.visitors).set({ lastSeenAt: new Date() }).where(eq(schema.visitors.id, visitor.id));
    await audit({
      actor: { type: "visitor", id: visitor?.id ?? null, label: visitor?.email ?? null },
      action: "visitor.visit_start",
      targetType: "link",
      targetId: link.id,
      metadata: { visitId: visit.id, device: meta.device, country: meta.country },
      ip: meta.ip,
    });
    await notifyLinkOpened(link, visitor?.email ?? "An anonymous visitor", meta.country);
  }

  return NextResponse.redirect(new URL(next, req.url));
}
