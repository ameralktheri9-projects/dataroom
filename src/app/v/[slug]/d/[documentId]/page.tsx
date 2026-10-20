import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { getBrand } from "@/lib/workspace";
import { visitorLang } from "@/lib/i18n/server";
import { audit } from "@/lib/audit";
import { requestMeta } from "@/lib/request";
import { downloadState } from "@/lib/access/engine";
import { approvalOf, findLinkBySlug, latestRequest, resolveAccess } from "@/lib/access/resolve";
import { documentInLink } from "@/lib/access/scope";
import { currentVisit } from "@/lib/access/visit";
import { watermarkText } from "@/lib/watermark";
import { fileKind } from "@/lib/utils";
import { SubmitButton } from "@/components/action-form";
import { buttonClass } from "@/components/ui";
import { Viewer } from "@/components/viewer";
import { Protection } from "@/components/viewer/protection";
import { VisitorShell } from "../../shell";
import { requestDownload } from "../../actions";

export const metadata = { title: "Document" };

export default async function VisitorDocumentPage({ params }: PageProps<"/v/[slug]/d/[documentId]">) {
  const { slug, documentId } = await params;
  const link = await findLinkBySlug(slug);
  if (!link) redirect(`/v/${slug}`);
  const { step, session, visitor } = await resolveAccess(link);
  if (step !== "granted") redirect(`/v/${slug}`);
  const visit = await currentVisit(session);
  if (!visit) redirect(`/v/${slug}/enter?next=${encodeURIComponent(`/v/${slug}/d/${documentId}`)}`);
  const doc = await documentInLink(link.id, documentId);
  if (!doc) redirect(`/v/${slug}`);

  const brand = await getBrand();
  const { lang, t } = await visitorLang();
  const meta = await requestMeta();
  const s = link.settings;
  const v = doc.version;

  await audit({
    actor: { type: "visitor", id: visitor?.id ?? null, label: visitor?.email ?? null },
    action: "document.view",
    targetType: "document",
    targetId: documentId,
    metadata: { linkId: link.id, visitId: visit.id, version: v.versionNumber },
    ip: meta.ip,
  });

  const request = visitor && s.download === "request" ? approvalOf(await latestRequest(visitor.id, link.id, "download", documentId)) : "none";
  const dl = downloadState(s, v.fileType, request);
  const watermark = s.watermark ? watermarkText({ email: visitor?.email ?? null, ip: meta.ip, at: new Date() }) : null;

  return (
    <VisitorShell brand={brand} lang={lang} t={t} back={`/v/${slug}/d/${documentId}`} wide>
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/v/${slug}`} className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-900">
            <ArrowLeft className="size-4 rtl:rotate-180" aria-hidden /> {t.back}
          </Link>
          <h1 className="mt-1 truncate text-lg font-semibold">{doc.document.name}</h1>
        </div>
        {dl === "allowed" && (
          <a href={`/api/v/${slug}/download/${documentId}`} className={buttonClass("secondary")}>
            <Download className="size-4" aria-hidden /> {t.download}
          </a>
        )}
        {dl === "request" && (
          <form action={requestDownload}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="documentId" value={documentId} />
            <SubmitButton variant="secondary" pendingText="…">
              {t.requestDownload}
            </SubmitButton>
          </form>
        )}
        {dl === "pending" && <span className="text-sm text-stone-500">{t.downloadPending}</span>}
        {dl === "rejected" && <span className="text-sm text-stone-500">{t.downloadRejected}</span>}
        {dl === "unsupported" && <span className="text-sm text-stone-500">{t.downloadUnsupported}</span>}
      </div>

      <Protection enabled={s.screenshotProtection} message={t.protectedMsg}>
        <div className="rounded-lg bg-stone-200/60 p-2 md:p-6">
          <Viewer
            kind={fileKind(v.fileType, v.fileName)}
            fileUrl={`/api/v/${slug}/file/${documentId}`}
            versionId={v.id}
            watermark={watermark}
            trackUrl={`/api/v/${slug}/track`}
            labels={t.viewer}
          />
        </div>
      </Protection>
    </VisitorShell>
  );
}
