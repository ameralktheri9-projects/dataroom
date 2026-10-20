import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, Folder } from "lucide-react";
import { getBrand } from "@/lib/workspace";
import { visitorLang } from "@/lib/i18n/server";
import { findLinkBySlug, latestRequest, resolveAccess } from "@/lib/access/resolve";
import { linkContents, type LinkContents } from "@/lib/access/scope";
import { currentVisit } from "@/lib/access/visit";
import type { GateStep } from "@/lib/access/engine";
import type { VisitorDict } from "@/lib/i18n/visitor";
import { formatBytes } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import { Viewer } from "@/components/viewer";
import { GateCard, VisitorShell } from "./shell";
import {
  changeEmail,
  requestAccess,
  resendCode,
  signNda,
  submitEmail,
  submitPassword,
  submitQuestionnaire,
  verifyCode,
} from "./actions";

export const metadata = { title: "Shared documents" };

export default async function VisitorPage({ params }: PageProps<"/v/[slug]">) {
  const { slug } = await params;
  const brand = await getBrand();
  const { lang, t } = await visitorLang();
  const back = `/v/${slug}`;
  const shell = (children: React.ReactNode, wide = false) => (
    <VisitorShell brand={brand} lang={lang} t={t} back={back} wide={wide}>
      {children}
    </VisitorShell>
  );

  const link = await findLinkBySlug(slug);
  if (!link) return shell(<Status step="unavailable" t={t} />);

  const { step, session, visitor } = await resolveAccess(link);
  const s = link.settings;

  const notYou = session.email ? (
    <form action={changeEmail} className="mt-4 text-center text-xs text-stone-500">
      <input type="hidden" name="slug" value={slug} />
      {session.email} · <button className="underline">{t.useAnotherEmail}</button>
    </form>
  ) : null;

  switch (step) {
    case "email":
      return shell(
        <GateCard title={t.emailTitle} body={t.emailBody}>
          <ActionForm action={submitEmail} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <Field label={t.email} htmlFor="email">
              <Input id="email" name="email" type="email" required autoComplete="email" autoFocus dir="ltr" />
            </Field>
            <Field label={`${t.name} (${t.optional})`} htmlFor="name">
              <Input id="name" name="name" autoComplete="name" />
            </Field>
            <Field label={`${t.company} (${t.optional})`} htmlFor="company">
              <Input id="company" name="company" autoComplete="organization" />
            </Field>
            <SubmitButton variant="accent" className="w-full" pendingText="…">
              {t.continue}
            </SubmitButton>
          </ActionForm>
        </GateCard>,
      );

    case "verify":
      return shell(
        <GateCard title={t.verifyTitle} body={t.verifyBody(session.email!)}>
          <ActionForm action={verifyCode} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <Field label={t.code} htmlFor="code">
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus dir="ltr" className="tracking-[0.4em]" />
            </Field>
            <SubmitButton variant="accent" className="w-full" pendingText="…">
              {t.verify}
            </SubmitButton>
          </ActionForm>
          <ActionForm action={resendCode} className="mt-3 text-center">
            <input type="hidden" name="slug" value={slug} />
            <button className="text-sm text-accent hover:underline">{t.resend}</button>
          </ActionForm>
          {notYou}
        </GateCard>,
      );

    case "password":
      return shell(
        <GateCard title={t.passwordTitle}>
          <ActionForm action={submitPassword} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <Field label={t.password} htmlFor="password">
              <Input id="password" name="password" type="password" required autoFocus autoComplete="off" />
            </Field>
            <SubmitButton variant="accent" className="w-full" pendingText="…">
              {t.continue}
            </SubmitButton>
          </ActionForm>
          {notYou}
        </GateCard>,
      );

    case "nda":
      return shell(
        <div className="space-y-6">
          <div>
            <h1 className="text-lg font-semibold">{t.ndaTitle}</h1>
            <p className="mt-1 text-sm text-stone-600">{t.ndaBody}</p>
          </div>
          <div className="max-h-[60vh] overflow-y-auto rounded-lg bg-stone-200/60 p-3">
            <Viewer kind="pdf" fileUrl={`/api/v/${slug}/agreement`} versionId="agreement" watermark={null} trackUrl={null} labels={t.viewer} />
          </div>
          <GateCard title={t.ndaTitle}>
            <ActionForm action={signNda} className="space-y-4">
              <input type="hidden" name="slug" value={slug} />
              <Field label={t.name} htmlFor="fullName">
                <Input id="fullName" name="fullName" required defaultValue={visitor?.name ?? ""} autoComplete="name" />
              </Field>
              <Field label={`${t.company} (${t.optional})`} htmlFor="company">
                <Input id="company" name="company" defaultValue={visitor?.company ?? ""} autoComplete="organization" />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="agree" required className="mt-0.5 size-4" />
                {t.ndaAgree}
              </label>
              <SubmitButton variant="accent" className="w-full" pendingText="…">
                {t.ndaSign}
              </SubmitButton>
            </ActionForm>
            {notYou}
          </GateCard>
        </div>,
      );

    case "questionnaire":
      return shell(
        <GateCard title={t.questionnaireTitle}>
          <ActionForm action={submitQuestionnaire} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            {s.questionnaire.questions.map((q) => (
              <Field key={q.id} label={q.required ? q.label : `${q.label} (${t.optional})`} htmlFor={`q_${q.id}`}>
                <Textarea id={`q_${q.id}`} name={`q_${q.id}`} rows={2} required={q.required} />
              </Field>
            ))}
            <SubmitButton variant="accent" className="w-full" pendingText="…">
              {t.submit}
            </SubmitButton>
          </ActionForm>
          {notYou}
        </GateCard>,
      );

    case "approval_pending": {
      const req = visitor ? await latestRequest(visitor.id, link.id, "access") : null;
      return shell(
        <GateCard title={req ? t.pendingTitle : t.requestTitle} body={req ? t.pendingBody : t.requestBody}>
          {!req && (
            <form action={requestAccess}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton variant="accent" className="w-full" pendingText="…">
                {t.requestAccess}
              </SubmitButton>
            </form>
          )}
          {notYou}
        </GateCard>,
      );
    }

    case "granted": {
      if (!(await currentVisit(session))) redirect(`/v/${slug}/enter`);
      const contents = await linkContents(link.id);
      return shell(
        <>
          <h1 className="mb-4 text-lg font-semibold">{t.documents}</h1>
          {contents.documents.length === 0 ? (
            <p className="rounded-lg bg-white p-8 text-center text-sm text-stone-500 shadow-sm">{t.empty}</p>
          ) : (
            <ContentList slug={slug} contents={contents} />
          )}
          {notYou}
        </>,
      );
    }

    default:
      return shell(
        <>
          <Status step={step} t={t} />
          {notYou}
        </>,
      );
  }
}

function Status({ step, t }: { step: GateStep; t: VisitorDict }) {
  const map: Partial<Record<GateStep, [string, string]>> = {
    unavailable: [t.unavailableTitle, t.unavailableBody],
    expired: [t.expiredTitle, t.expiredBody],
    not_allowed: [t.notAllowedTitle, t.notAllowedBody],
    suspended: [t.suspendedTitle, t.suspendedBody],
    revoked: [t.revokedTitle, t.revokedBody],
    approval_rejected: [t.rejectedTitle, t.rejectedBody],
  };
  const [title, body] = map[step] ?? [t.unavailableTitle, t.unavailableBody];
  return <GateCard title={title} body={body} />;
}

function ContentList({ slug, contents }: { slug: string; contents: LinkContents }) {
  const folderById = new Map(contents.folders.map((f) => [f.id, f]));
  const docsIn = (folderId: string | null) => contents.documents.filter((d) => d.document.folderId === folderId);
  const subfolders = (parentId: string) => contents.folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name));
  const rootDocs = contents.documents.filter((d) => contents.rootDocumentIds.includes(d.document.id) && !folderById.has(d.document.folderId ?? ""));

  function DocRow({ d, depth }: { d: LinkContents["documents"][number]; depth: number }) {
    return (
      <li>
        <Link
          href={`/v/${slug}/d/${d.document.id}`}
          className="flex items-center gap-3 px-4 py-3 hover:bg-stone-50"
          style={{ paddingInlineStart: 16 + depth * 20 }}
        >
          <FileText className="size-4 shrink-0 text-stone-400" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-stone-900">{d.document.name}</span>
          <span className="shrink-0 text-xs text-stone-500" dir="ltr">
            {d.version.pageCount ? `${d.version.pageCount} pp · ` : ""}
            {formatBytes(d.version.size)}
          </span>
        </Link>
      </li>
    );
  }

  function FolderBlock({ id, depth }: { id: string; depth: number }) {
    const f = folderById.get(id)!;
    return (
      <>
        <li className="flex items-center gap-3 bg-stone-50/60 px-4 py-2.5" style={{ paddingInlineStart: 16 + depth * 20 }}>
          <Folder className="size-4 shrink-0 text-amber-500" aria-hidden />
          <span className="text-sm font-semibold text-stone-700">{f.name}</span>
        </li>
        {subfolders(id).map((sf) => (
          <FolderBlock key={sf.id} id={sf.id} depth={depth + 1} />
        ))}
        {docsIn(id).map((d) => (
          <DocRow key={d.document.id} d={d} depth={depth + 1} />
        ))}
      </>
    );
  }

  return (
    <ul className="divide-y divide-stone-100 overflow-hidden rounded-lg border border-stone-200 bg-white">
      {contents.rootFolderIds
        // a chosen folder inside another chosen folder is already shown under its parent
        .filter((id) => folderById.has(id) && !folderById.has(folderById.get(id)!.parentId ?? ""))
        .map((id) => (
          <FolderBlock key={id} id={id} depth={0} />
        ))}
      {rootDocs.map((d) => (
        <DocRow key={d.document.id} d={d} depth={0} />
      ))}
    </ul>
  );
}
