import { emailIsAllowed, type LinkSettings } from "./settings";

// Pure decision logic for what a visitor sees when opening a link.
// Every file request re-runs this against fresh database state, so a link
// disabled or a visitor revoked a second ago is refused on the next request.

export type GateStep =
  | "unavailable" // deleted or disabled link
  | "expired"
  | "email"
  | "verify"
  | "not_allowed" // email is not on the allowed list
  | "suspended"
  | "revoked"
  | "password"
  | "nda"
  | "questionnaire"
  | "approval_pending"
  | "approval_rejected"
  | "granted";

export const TERMINAL_STEPS: GateStep[] = [
  "unavailable",
  "expired",
  "not_allowed",
  "suspended",
  "revoked",
  "approval_rejected",
];

export type ApprovalState = "none" | "pending" | "approved" | "rejected";

export type AccessInput = {
  now: Date;
  link: {
    status: "active" | "disabled";
    deleted: boolean;
    expiresAt: Date | null;
    settings: LinkSettings;
    passwordVersion: number;
  };
  allowList: string[];
  // from the signed visitor cookie
  session: {
    email: string | null;
    emailVerified: boolean;
    passwordVersion: number | null;
  };
  // from the database, for session.email
  visitor: { status: "active" | "suspended" | "revoked" } | null;
  ndaSigned: boolean;
  questionnaireDone: boolean;
  approval: ApprovalState;
};

/** Gates are checked in this order (FR-90): link → identity → status → password → NDA → questionnaire → approval. */
export function evaluateAccess(i: AccessInput): GateStep {
  const s = i.link.settings;

  if (i.link.deleted || i.link.status !== "active") return "unavailable";
  if (i.link.expiresAt && i.link.expiresAt.getTime() <= i.now.getTime()) return "expired";

  const needsEmail = s.audience === "email";
  if (needsEmail) {
    if (!i.session.email) return "email";
    if (s.verifyEmail && !i.session.emailVerified) return "verify";
    if (s.allowList && !emailIsAllowed(i.session.email, i.allowList)) return "not_allowed";
  }

  // A visitor suspended or revoked anywhere loses access everywhere,
  // including on "Anyone with link" links if they identified themselves earlier.
  if (i.visitor?.status === "revoked") return "revoked";
  if (i.visitor?.status === "suspended") return "suspended";

  if (s.requirePassword && i.session.passwordVersion !== i.link.passwordVersion) return "password";

  if (needsEmail) {
    if (s.requireNda && !i.ndaSigned) return "nda";
    if (s.questionnaire.enabled && s.questionnaire.questions.length > 0 && !i.questionnaireDone) {
      return "questionnaire";
    }
    if (s.requireApproval) {
      if (i.approval === "rejected") return "approval_rejected";
      if (i.approval !== "approved") return "approval_pending";
    }
  }

  return "granted";
}

// ---------------------------------------------------------------- downloads (FR-26)

export type DownloadState =
  | "off"
  | "allowed"
  | "request" // visitor may ask
  | "pending" // asked, awaiting decision
  | "rejected"
  | "unsupported"; // watermark is on but this file type cannot be stamped yet

/** File types we can stamp a watermark onto when downloaded. */
export function canWatermarkDownload(mime: string): boolean {
  return mime === "application/pdf" || mime === "image/png" || mime === "image/jpeg";
}

export function downloadState(
  settings: LinkSettings,
  mime: string,
  request: ApprovalState,
): DownloadState {
  if (settings.download === "off") return "off";
  // Acceptance criterion: the watermark appears on every downloaded file.
  // Office/video files are viewable but not downloadable under a watermark
  // until Office→PDF conversion lands in Phase 2.
  if (settings.watermark && !canWatermarkDownload(mime)) return "unsupported";
  if (settings.download === "allowed") return "allowed";
  if (request === "approved") return "allowed";
  if (request === "pending") return "pending";
  if (request === "rejected") return "rejected";
  return "request";
}
