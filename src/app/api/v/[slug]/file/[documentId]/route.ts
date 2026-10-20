import { NextResponse } from "next/server";
import { grantedDocument } from "@/lib/access/guard";
import { storage } from "@/lib/storage";

// Viewer source for a visitor. Re-checks access on every request and only then issues a
// 5-minute signed URL, so a revoked visitor cannot reopen files even with an old URL.
export async function GET(req: Request, ctx: RouteContext<"/api/v/[slug]/file/[documentId]">) {
  const { slug, documentId } = await ctx.params;
  const g = await grantedDocument(slug, documentId);
  if (!g) return new NextResponse("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  const url = await storage().readUrl(g.doc.version.storageKey, { contentType: g.doc.version.fileType });
  return NextResponse.redirect(new URL(url, req.url), { headers: { "Cache-Control": "private, no-store" } });
}
