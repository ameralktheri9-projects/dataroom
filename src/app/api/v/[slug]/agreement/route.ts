import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { findLinkBySlug, resolveAccess } from "@/lib/access/resolve";
import { storage } from "@/lib/storage";

// The NDA text a visitor must read at the NDA step.
export async function GET(req: Request, ctx: RouteContext<"/api/v/[slug]/agreement">) {
  const { slug } = await ctx.params;
  const link = await findLinkBySlug(slug);
  if (!link?.agreementId) return new NextResponse("Not found", { status: 404 });
  const { step } = await resolveAccess(link);
  if (!["nda", "questionnaire", "approval_pending", "granted"].includes(step)) return new NextResponse("Forbidden", { status: 403 });
  const db = await getDb();
  const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, link.agreementId)).limit(1);
  if (!a) return new NextResponse("Not found", { status: 404 });
  const url = await storage().readUrl(a.storageKey, { contentType: "application/pdf" });
  return NextResponse.redirect(new URL(url, req.url), { headers: { "Cache-Control": "private, no-store" } });
}
