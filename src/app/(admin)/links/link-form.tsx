"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import { ChevronRight, FileText, Folder, Plus, Trash2 } from "lucide-react";
import { Alert, Card, CardHeader, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/action-form";
import {
  type ExpiryPreset,
  type LinkSettings,
  normalizeAllowEntry,
  validateLinkSettings,
} from "@/lib/access/settings";
import type { FormState } from "@/lib/form";
import { cn } from "@/lib/utils";
import { saveLink, type LinkPayload } from "./actions";

export type TreeFolder = { id: string; name: string; parentId: string | null };
export type TreeDoc = { id: string; name: string; folderId: string | null };

export type LinkFormInitial = {
  id: string | null;
  name: string;
  folderIds: string[];
  documentIds: string[];
  settings: LinkSettings;
  allowListEntries: string[];
  hasPassword: boolean;
  agreementId: string | null;
  expiryPreset: ExpiryPreset;
  expiryCustom: string | null;
};

export function LinkForm({
  initial,
  folders,
  documents,
  agreements,
}: {
  initial: LinkFormInitial;
  folders: TreeFolder[];
  documents: TreeDoc[];
  agreements: { id: string; name: string; version: number }[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(saveLink, {});
  const [name, setName] = useState(initial.name);
  const [folderIds, setFolderIds] = useState(new Set(initial.folderIds));
  const [documentIds, setDocumentIds] = useState(new Set(initial.documentIds));
  const [s, setS] = useState<LinkSettings>(initial.settings);
  const [allowText, setAllowText] = useState(initial.allowListEntries.join("\n"));
  const [password, setPassword] = useState("");
  const [agreementId, setAgreementId] = useState<string | null>(initial.agreementId ?? agreements[0]?.id ?? null);
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>(initial.expiryPreset);
  const [expiryCustom, setExpiryCustom] = useState(initial.expiryCustom);

  const set = <K extends keyof LinkSettings>(k: K, v: LinkSettings[K]) => setS((prev) => ({ ...prev, [k]: v }));
  const anyone = s.audience === "anyone";
  const allowEntries = allowText.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);

  // Same rules the server enforces (FR-22), shown live.
  const issues = useMemo(
    () =>
      validateLinkSettings(s, {
        allowListEntries: allowEntries.map(normalizeAllowEntry),
        hasPassword: initial.hasPassword || password.trim().length > 0,
        agreementId: s.requireNda ? agreementId : null,
        expiresAt: null,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s, allowText, password, agreementId, initial.hasPassword],
  );

  // Switching to "Anyone with link" clears toggles that need an email, rather than leaving a conflict.
  function setAudience(a: "anyone" | "email") {
    if (a === "anyone") {
      setS((prev) => ({
        ...prev,
        audience: "anyone",
        verifyEmail: false,
        allowList: false,
        requireNda: false,
        requireApproval: false,
        questionnaire: { ...prev.questionnaire, enabled: false },
        download: prev.download === "request" ? "off" : prev.download,
      }));
    } else set("audience", "email");
  }

  const payload: LinkPayload = {
    id: initial.id,
    name,
    folderIds: [...folderIds],
    documentIds: [...documentIds],
    settings: s,
    allowListEntries: allowEntries,
    password,
    agreementId,
    expiryPreset,
    expiryCustom: expiryPreset === "custom" ? expiryCustom : null,
  };

  const nothingSelected = folderIds.size + documentIds.size === 0;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <Card className="p-5">
        <label htmlFor="link-name" className="mb-1 block text-sm font-medium">
          Link name
        </label>
        <Input id="link-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Series A — Acme Ventures" required />
        <p className="mt-1 text-xs text-stone-500">Only your team sees this name.</p>
      </Card>

      <Card>
        <CardHeader title="What this link opens" description="Visitors only see what you tick here. Folders include everything inside them." />
        <div className="max-h-80 overflow-y-auto px-3 py-2">
          <ContentTree
            folders={folders}
            documents={documents}
            folderIds={folderIds}
            documentIds={documentIds}
            onToggleFolder={(id) => setFolderIds((prev) => toggle(prev, id))}
            onToggleDoc={(id) => setDocumentIds((prev) => toggle(prev, id))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Who can open it" />
        <div className="space-y-4 px-5 py-4">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">Audience</legend>
            <RadioCard checked={anyone} onChange={() => setAudience("anyone")} title="Anyone with the link" body="No email asked. Analytics are anonymous." />
            <RadioCard checked={!anyone} onChange={() => setAudience("email")} title="Email required" body="Visitors enter their email before viewing." />
          </fieldset>
          <Toggle
            checked={s.verifyEmail}
            disabled={anyone}
            onChange={(v) => set("verifyEmail", v)}
            label="Verify email with a code"
            hint="We email a 6-digit code that expires in 10 minutes."
          />
          <Toggle
            checked={s.allowList}
            disabled={anyone}
            onChange={(v) => set("allowList", v)}
            label="Only allow these emails or domains"
          >
            {s.allowList && (
              <Textarea
                rows={3}
                value={allowText}
                onChange={(e) => setAllowText(e.target.value)}
                placeholder={"jane@acmevc.com\nacmevc.com"}
                className="mt-2 font-mono text-xs"
              />
            )}
          </Toggle>
          {anyone && <p className="text-xs text-stone-500">Options that need the visitor&apos;s email are off while &ldquo;Anyone with the link&rdquo; is selected.</p>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Before they can view" description="Steps are shown to visitors in this order." />
        <div className="space-y-4 px-5 py-4">
          <Toggle checked={s.requirePassword} onChange={(v) => set("requirePassword", v)} label="Password">
            {s.requirePassword && (
              <Input
                type="password"
                autoComplete="new-password"
                className="mt-2 max-w-xs"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={initial.hasPassword ? "Leave blank to keep the current password" : "At least 6 characters"}
              />
            )}
          </Toggle>
          <Toggle checked={s.requireNda} disabled={anyone || agreements.length === 0} onChange={(v) => set("requireNda", v)} label="Accept an NDA" hint={agreements.length === 0 ? "Upload an agreement in Settings → Agreements first." : undefined}>
            {s.requireNda && (
              <Select className="mt-2 max-w-xs" value={agreementId ?? ""} onChange={(e) => setAgreementId(e.target.value || null)}>
                {agreements.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (v{a.version})
                  </option>
                ))}
              </Select>
            )}
          </Toggle>
          <Toggle
            checked={s.questionnaire.enabled}
            disabled={anyone}
            onChange={(v) => set("questionnaire", { ...s.questionnaire, enabled: v })}
            label="Pre-access questionnaire"
          >
            {s.questionnaire.enabled && (
              <QuestionEditor questions={s.questionnaire.questions} onChange={(questions) => set("questionnaire", { enabled: true, questions })} />
            )}
          </Toggle>
          <Toggle
            checked={s.requireApproval}
            disabled={anyone}
            onChange={(v) => set("requireApproval", v)}
            label="Manual approval"
            hint="Each new visitor waits until someone on the team approves them from Home."
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Protection and downloads" />
        <div className="space-y-4 px-5 py-4">
          <Toggle checked={s.watermark} onChange={(v) => set("watermark", v)} label="Watermark" hint="Visitor email, date/time and IP on every page and every download." />
          <Toggle
            checked={s.screenshotProtection}
            onChange={(v) => set("screenshotProtection", v)}
            label="Screenshot deterrence"
            hint="Blurs when the window loses focus, blocks print and capture shortcuts. It discourages, but cannot fully prevent, screenshots."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="download">
                Downloads
              </label>
              <Select id="download" value={s.download} onChange={(e) => set("download", e.target.value as LinkSettings["download"])}>
                <option value="off">Off — view only</option>
                <option value="allowed">Allowed</option>
                <option value="request" disabled={anyone}>
                  On request (team approves)
                </option>
              </Select>
              {s.watermark && s.download !== "off" && (
                <p className="mt-1 text-xs text-stone-500">With watermark on, only PDFs and images can be downloaded (stamped).</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="expiry">
                Expires
              </label>
              <Select id="expiry" value={expiryPreset} onChange={(e) => setExpiryPreset(e.target.value as ExpiryPreset)}>
                <option value="never">Never</option>
                <option value="7">In 7 days</option>
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="custom">On a date…</option>
              </Select>
              {expiryPreset === "custom" && (
                <Input
                  type="datetime-local"
                  className="mt-2"
                  value={expiryCustom ? toLocalInput(expiryCustom) : ""}
                  onChange={(e) => setExpiryCustom(e.target.value ? new Date(e.target.value).toISOString() : null)}
                />
              )}
            </div>
          </div>
          <Toggle checked={s.notifyOnOpen} onChange={(v) => set("notifyOnOpen", v)} label="Email me every time it is opened" />
        </div>
      </Card>

      {(issues.length > 0 || state.error) && (
        <Alert tone="red">
          {state.error ?? issues.map((i) => <span key={i.message} className="block">{i.message}</span>)}
        </Alert>
      )}
      {state.success && <Alert tone="green">{state.success}</Alert>}

      <div className="flex justify-end">
        <SubmitButton disabled={issues.length > 0 || nothingSelected || !name.trim()} pendingText="Saving…">
          {initial.id ? "Save changes" : "Create link"}
        </SubmitButton>
      </div>
    </form>
  );
}

function toggle(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn(disabled && "opacity-50")}>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-stone-900"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium">{label}</span>
          {hint && <span className="block text-xs text-stone-500">{hint}</span>}
        </span>
      </label>
      {children && <div className="pl-7">{children}</div>}
    </div>
  );
}

function RadioCard({ checked, onChange, title, body }: { checked: boolean; onChange: () => void; title: string; body: string }) {
  return (
    <label className={cn("flex cursor-pointer gap-3 rounded-md border p-3", checked ? "border-stone-900 bg-stone-50" : "border-stone-200")}>
      <input type="radio" className="mt-0.5 accent-stone-900" checked={checked} onChange={onChange} />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-stone-500">{body}</span>
      </span>
    </label>
  );
}

function QuestionEditor({
  questions,
  onChange,
}: {
  questions: LinkSettings["questionnaire"]["questions"];
  onChange: (q: LinkSettings["questionnaire"]["questions"]) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      {questions.map((q, i) => (
        <div key={q.id} className="flex items-center gap-2">
          <Input
            value={q.label}
            placeholder="e.g. Which fund are you with?"
            onChange={(e) => onChange(questions.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <label className="flex shrink-0 items-center gap-1 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={q.required}
              onChange={(e) => onChange(questions.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)))}
            />
            Required
          </label>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => onChange(questions.filter((_, j) => j !== i))} aria-label="Remove question">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={buttonClass("secondary", "sm")}
        onClick={() => onChange([...questions, { id: crypto.randomUUID().slice(0, 8), label: "", required: true }])}
        disabled={questions.length >= 20}
      >
        <Plus className="size-4" /> Add question
      </button>
    </div>
  );
}

function ContentTree({
  folders,
  documents,
  folderIds,
  documentIds,
  onToggleFolder,
  onToggleDoc,
}: {
  folders: TreeFolder[];
  documents: TreeDoc[];
  folderIds: Set<string>;
  documentIds: Set<string>;
  onToggleFolder: (id: string) => void;
  onToggleDoc: (id: string) => void;
}) {
  const childrenOf = (parent: string | null) => folders.filter((f) => f.parentId === parent).sort((a, b) => a.name.localeCompare(b.name));
  const docsIn = (parent: string | null) => documents.filter((d) => d.folderId === parent).sort((a, b) => a.name.localeCompare(b.name));
  // expand the path to anything already selected
  const initiallyOpen = useMemo(() => {
    const open = new Set<string>();
    const parentOf = new Map(folders.map((f) => [f.id, f.parentId]));
    const openUp = (id: string | null) => {
      while (id) {
        open.add(id);
        id = parentOf.get(id) ?? null;
      }
    };
    for (const id of folderIds) openUp(parentOf.get(id) ?? null);
    for (const d of documents) if (documentIds.has(d.id)) openUp(d.folderId);
    return open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [open, setOpen] = useState(initiallyOpen);

  if (folders.length === 0 && documents.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-stone-500">Upload documents first.</p>;
  }

  function render(parent: string | null, depth: number, coveredByParent: boolean): ReactNode {
    return (
      <>
        {childrenOf(parent).map((f) => {
          const isOpen = open.has(f.id);
          const covered = coveredByParent || folderIds.has(f.id);
          return (
            <div key={f.id}>
              <div className="flex items-center gap-1.5 rounded px-1 py-1 hover:bg-stone-50" style={{ paddingLeft: depth * 18 + 4 }}>
                <button
                  type="button"
                  className="text-stone-400"
                  aria-label={isOpen ? "Collapse" : "Expand"}
                  onClick={() => setOpen((prev) => toggle(prev, f.id))}
                >
                  <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} />
                </button>
                <input
                  type="checkbox"
                  className="size-4 accent-stone-900"
                  checked={covered}
                  disabled={coveredByParent}
                  onChange={() => onToggleFolder(f.id)}
                  aria-label={`Share folder ${f.name}`}
                />
                <Folder className="size-4 text-amber-500" aria-hidden />
                <span className="text-sm">{f.name}</span>
              </div>
              {isOpen && render(f.id, depth + 1, covered)}
            </div>
          );
        })}
        {docsIn(parent).map((d) => (
          <label
            key={d.id}
            className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-1 hover:bg-stone-50"
            style={{ paddingLeft: depth * 18 + 26 }}
          >
            <input
              type="checkbox"
              className="size-4 accent-stone-900"
              checked={coveredByParent || documentIds.has(d.id)}
              disabled={coveredByParent}
              onChange={() => onToggleDoc(d.id)}
            />
            <FileText className="size-4 text-stone-400" aria-hidden />
            <span className="text-sm">{d.name}</span>
          </label>
        ))}
      </>
    );
  }

  return <div>{render(null, 0, false)}</div>;
}
