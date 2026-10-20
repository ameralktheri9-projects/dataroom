import { z } from "zod";

// Sharing toggles for a link (BRD FR-21 … FR-28). Stored as JSON on links.settings.

export const questionSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(300),
  required: z.boolean().default(true),
});

export const linkSettingsSchema = z.object({
  // FR-21 — who may open the link
  audience: z.enum(["anyone", "email"]).default("email"),
  verifyEmail: z.boolean().default(false),
  allowList: z.boolean().default(false),
  // FR-23 — gates
  requirePassword: z.boolean().default(false),
  requireNda: z.boolean().default(false),
  requireApproval: z.boolean().default(false),
  questionnaire: z
    .object({
      enabled: z.boolean().default(false),
      questions: z.array(questionSchema).max(20).default([]),
    })
    .default({ enabled: false, questions: [] }),
  // FR-24 / FR-25 — protection
  watermark: z.boolean().default(false),
  screenshotProtection: z.boolean().default(false),
  // FR-26
  download: z.enum(["off", "allowed", "request"]).default("off"),
  // FR-28
  notifyOnOpen: z.boolean().default(true),
});

export type LinkSettings = z.infer<typeof linkSettingsSchema>;
export type Question = z.infer<typeof questionSchema>;

export const defaultLinkSettings: LinkSettings = linkSettingsSchema.parse({});

export type SettingsField =
  | keyof LinkSettings
  | "allowListEntries"
  | "password"
  | "agreementId"
  | "expiresAt";

export type SettingsIssue = { field: SettingsField; message: string };

// Toggles that need to know who the visitor is, so they cannot be combined with
// "Anyone with link". The UI greys them out; validateLinkSettings is the backstop.
export const IDENTITY_TOGGLES = [
  "verifyEmail",
  "allowList",
  "requireNda",
  "requireApproval",
  "questionnaire",
  "downloadOnRequest",
] as const;

export type IdentityToggle = (typeof IDENTITY_TOGGLES)[number];

export function identityTogglesOn(s: LinkSettings): IdentityToggle[] {
  const on: IdentityToggle[] = [];
  if (s.verifyEmail) on.push("verifyEmail");
  if (s.allowList) on.push("allowList");
  if (s.requireNda) on.push("requireNda");
  if (s.requireApproval) on.push("requireApproval");
  if (s.questionnaire.enabled) on.push("questionnaire");
  if (s.download === "request") on.push("downloadOnRequest");
  return on;
}

const TOGGLE_LABELS: Record<IdentityToggle, string> = {
  verifyEmail: "Verified email",
  allowList: "Allowed email/domain list",
  requireNda: "NDA",
  requireApproval: "Manual approval",
  questionnaire: "Pre-access questionnaire",
  downloadOnRequest: "Download on request",
};

const TOGGLE_FIELD: Record<IdentityToggle, SettingsField> = {
  verifyEmail: "verifyEmail",
  allowList: "allowList",
  requireNda: "requireNda",
  requireApproval: "requireApproval",
  questionnaire: "questionnaire",
  downloadOnRequest: "download",
};

export type SettingsContext = {
  allowListEntries: string[];
  // true when the link already has a password stored or a new one is being set
  hasPassword: boolean;
  agreementId: string | null;
  expiresAt: Date | null;
  now?: Date;
};

/** FR-22: block conflicting toggles and incomplete configuration. */
export function validateLinkSettings(s: LinkSettings, ctx: SettingsContext): SettingsIssue[] {
  const issues: SettingsIssue[] = [];

  if (s.audience === "anyone") {
    for (const t of identityTogglesOn(s)) {
      issues.push({
        field: TOGGLE_FIELD[t],
        message: `"Anyone with link" cannot be combined with ${TOGGLE_LABELS[t]}, which needs the visitor's email.`,
      });
    }
  }

  if (s.allowList) {
    const entries = ctx.allowListEntries.map(normalizeAllowEntry).filter(Boolean);
    if (entries.length === 0) {
      issues.push({ field: "allowListEntries", message: "Add at least one email or domain." });
    }
    for (const raw of ctx.allowListEntries) {
      if (raw.trim() && !isValidAllowEntry(raw)) {
        issues.push({ field: "allowListEntries", message: `"${raw.trim()}" is not an email or domain.` });
      }
    }
  }

  if (s.requirePassword && !ctx.hasPassword) {
    issues.push({ field: "password", message: "Set a password or turn the password gate off." });
  }

  if (s.requireNda && !ctx.agreementId) {
    issues.push({ field: "agreementId", message: "Choose which agreement visitors must accept." });
  }

  if (s.questionnaire.enabled && s.questionnaire.questions.length === 0) {
    issues.push({ field: "questionnaire", message: "Add at least one question or turn the questionnaire off." });
  }

  if (ctx.expiresAt && ctx.expiresAt.getTime() <= (ctx.now ?? new Date()).getTime()) {
    issues.push({ field: "expiresAt", message: "Expiry must be in the future." });
  }

  return issues;
}

// ---------------------------------------------------------------- allowed list

/** "Jane@Acme.com" → "jane@acme.com"; "@Acme.com" / "acme.com" → "acme.com" */
export function normalizeAllowEntry(raw: string): string {
  const v = raw.trim().toLowerCase();
  return v.startsWith("@") ? v.slice(1) : v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

export function isValidAllowEntry(raw: string): boolean {
  const v = normalizeAllowEntry(raw);
  return v.includes("@") ? EMAIL_RE.test(v) : DOMAIN_RE.test(v);
}

/** Exact email match, or the email's domain (or a parent domain) is listed. */
export function emailIsAllowed(email: string, entries: string[]): boolean {
  const e = email.trim().toLowerCase();
  const domain = e.split("@")[1];
  if (!domain) return false;
  for (const raw of entries) {
    const entry = normalizeAllowEntry(raw);
    if (!entry) continue;
    if (entry.includes("@")) {
      if (entry === e) return true;
    } else if (domain === entry || domain.endsWith("." + entry)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- expiry presets (FR-27)

export const EXPIRY_PRESETS = ["never", "7", "30", "90", "custom"] as const;
export type ExpiryPreset = (typeof EXPIRY_PRESETS)[number];

export function expiryFromPreset(preset: ExpiryPreset, custom: string | null, now = new Date()): Date | null {
  if (preset === "never") return null;
  if (preset === "custom") {
    if (!custom) return null;
    const d = new Date(custom);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(now.getTime() + Number(preset) * 24 * 60 * 60 * 1000);
}
