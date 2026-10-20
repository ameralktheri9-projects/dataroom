import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { downloadState } from "@/lib/access/engine";
import { grantedDocument } from "@/lib/access/guard";
import { approvalOf, latestRequest } from "@/lib/access/resolve";
import { metaFromHeaders } from "@/lib/request";
import { contentDisposition, storage } from "@/lib/storage";
import { watermarkImageAsPdf, watermarkPdf } from "@/lib/watermark";

// FR-26 downloads. With the watermark on, the file is stamped server-side (FR-24) and streamed back;
// otherwise the visitor is redirected to a short-lived signed URL.
export async function GET(req: Request, ctx: RouteContext<"/api/v/[slug]/download/[documentId]">) {
  const { slug, documentId } = await ctx.params;
  const g = await grantedDocument(slug, documentId);
  if (!g) return new NextResponse("Forbidden", { status: 403 });

  const { link, visitor, visit, doc } = g;
  const request = visitor ? approvalOf(await latestRequest(visitor.id, link.id, "download", documentId)) : "none";
  const state = downloadState(link.settings, doc.version.fileType, request);
  if (state !== "allowed") return new NextResponse("Download not allowed", { status: 403 });

  const db = await getDb();
  const approvedBy =
    link.settings.download === "request" && visitor
      ? ((await latestRequest(visitor.id, link.id, "download", documentId))?.decidedBy ?? null)
      : null;
  await db.insert(schema.downloads).values({ visitId: visit.id, documentVersionId: doc.version.id, approvedBy });
  const meta = metaFromHeaders(req.headers);
  await audit({
    actor: { type: "visitor", id: visitor?.id ?? null, label: visitor?.email ?? null },
    action: "document.download",
    targetType: "document",
    targetId: documentId,
    metadata: { linkId: link.id, version: doc.version.versionNumber, watermarked: link.settings.watermark },
    ip: meta.ip,
  });
  if (visitor) await db.update(schema.visitors).set({ lastSeenAt: new Date() }).where(eq(schema.visitors.id, visitor.id));

  if (!link.settings.watermark) {
    const url = await storage().readUrl(doc.version.storageKey, { contentType: doc.version.fileType, downloadName: doc.version.fileName });
    return NextResponse.redirect(new URL(url, req.url), { headers: { "Cache-Control": "private, no-store" } });
  }

  const wm = { email: visitor?.email ?? null, ip: meta.ip, at: new Date() };
  const original = await storage().get(doc.version.storageKey);
  const stamped =
    doc.version.fileType === "application/pdf"
      ? await watermarkPdf(original, wm)
      : await watermarkImageAsPdf(original, doc.version.fileType, wm);
  const name = doc.version.fileName.replace(/\.[^.]+$/, "") + ".pdf";
  return new NextResponse(Buffer.from(stamped), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(name),
      "Cache-Control": "private, no-store",
    },
  });
}
