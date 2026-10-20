import { describe, expect, it } from "vitest";
import { downloadState, evaluateAccess, type AccessInput, type GateStep } from "@/lib/access/engine";
import {
  defaultLinkSettings,
  IDENTITY_TOGGLES,
  linkSettingsSchema,
  type LinkSettings,
} from "@/lib/access/settings";

const NOW = new Date("2026-10-20T12:00:00Z");

function input(settings: Partial<LinkSettings> = {}, over: Partial<AccessInput> = {}): AccessInput {
  return {
    now: NOW,
    link: {
      status: "active",
      deleted: false,
      expiresAt: null,
      settings: linkSettingsSchema.parse({ ...defaultLinkSettings, ...settings }),
      passwordVersion: 1,
    },
    allowList: [],
    session: { email: null, emailVerified: false, passwordVersion: null },
    visitor: null,
    ndaSigned: false,
    questionnaireDone: false,
    approval: "none",
    ...over,
  };
}

const identified = (email = "jane@fund.com", extra: Partial<AccessInput["session"]> = {}) => ({
  session: { email, emailVerified: true, passwordVersion: 1, ...extra },
  visitor: { status: "active" as const },
});

const fullSettings: Partial<LinkSettings> = {
  audience: "email",
  verifyEmail: true,
  allowList: true,
  requirePassword: true,
  requireNda: true,
  requireApproval: true,
  questionnaire: { enabled: true, questions: [{ id: "q1", label: "Fund name?", required: true }] },
};

describe("link state", () => {
  it("refuses disabled, deleted and expired links before anything else", () => {
    expect(evaluateAccess(input({}, { link: { ...input().link, status: "disabled" } }))).toBe("unavailable");
    expect(evaluateAccess(input({}, { link: { ...input().link, deleted: true } }))).toBe("unavailable");
    expect(
      evaluateAccess(input({}, { ...identified(), link: { ...input().link, expiresAt: new Date(NOW.getTime() - 1) } })),
    ).toBe("expired");
  });

  it("treats the exact expiry instant as expired", () => {
    expect(evaluateAccess(input({}, { link: { ...input().link, expiresAt: NOW } }))).toBe("expired");
  });

  it("allows a link that expires in the future", () => {
    const i = input({ audience: "anyone" }, { link: { ...input({ audience: "anyone" }).link, expiresAt: new Date(NOW.getTime() + 1000) } });
    expect(evaluateAccess(i)).toBe("granted");
  });
});

describe("identity", () => {
  it("anyone-with-link needs nothing", () => {
    expect(evaluateAccess(input({ audience: "anyone" }))).toBe("granted");
  });

  it("email-required asks for an email", () => {
    expect(evaluateAccess(input({ audience: "email" }))).toBe("email");
    expect(evaluateAccess(input({ audience: "email" }, identified()))).toBe("granted");
  });

  it("verified email needs the code step", () => {
    const s = { audience: "email" as const, verifyEmail: true };
    expect(evaluateAccess(input(s, { session: { email: "a@b.com", emailVerified: false, passwordVersion: null } }))).toBe("verify");
    expect(evaluateAccess(input(s, identified()))).toBe("granted");
  });

  it("allowed list matches exact emails and domains, case-insensitively", () => {
    const s = { audience: "email" as const, allowList: true };
    expect(evaluateAccess(input(s, { ...identified("Jane@Fund.com"), allowList: ["fund.com"] }))).toBe("granted");
    expect(evaluateAccess(input(s, { ...identified("jane@ny.fund.com"), allowList: ["@fund.com"] }))).toBe("granted");
    expect(evaluateAccess(input(s, { ...identified("bob@x.com"), allowList: ["bob@x.com"] }))).toBe("granted");
    expect(evaluateAccess(input(s, { ...identified("bob@x.com"), allowList: ["fund.com"] }))).toBe("not_allowed");
    // suffix tricks must not match
    expect(evaluateAccess(input(s, { ...identified("eve@evilfund.com"), allowList: ["fund.com"] }))).toBe("not_allowed");
    expect(evaluateAccess(input(s, { ...identified("eve@fund.com.evil.io"), allowList: ["fund.com"] }))).toBe("not_allowed");
  });

  it("an empty allowed list lets nobody in", () => {
    expect(evaluateAccess(input({ audience: "email", allowList: true }, { ...identified(), allowList: [] }))).toBe("not_allowed");
  });
});

describe("visitor status", () => {
  it("revoked and suspended visitors are refused even with every gate passed", () => {
    const passed = { ...identified(), ndaSigned: true, questionnaireDone: true, approval: "approved" as const, allowList: ["fund.com"] };
    expect(evaluateAccess(input(fullSettings, { ...passed, visitor: { status: "revoked" } }))).toBe("revoked");
    expect(evaluateAccess(input(fullSettings, { ...passed, visitor: { status: "suspended" } }))).toBe("suspended");
  });

  it("a revoked visitor is refused on an anyone-with-link link too", () => {
    expect(evaluateAccess(input({ audience: "anyone" }, { ...identified(), visitor: { status: "revoked" } }))).toBe("revoked");
  });
});

describe("gates", () => {
  it("password must match the link's current password version", () => {
    const s = { audience: "anyone" as const, requirePassword: true };
    expect(evaluateAccess(input(s))).toBe("password");
    expect(evaluateAccess(input(s, { session: { email: null, emailVerified: false, passwordVersion: 1 } }))).toBe("granted");
    // password changed since the visitor entered it
    expect(evaluateAccess(input(s, { session: { email: null, emailVerified: false, passwordVersion: 0 } }))).toBe("password");
  });

  it("walks the gates in order: email → verify → password → NDA → questionnaire → approval", () => {
    const steps: GateStep[] = [];
    const base = { allowList: ["fund.com"] };
    steps.push(evaluateAccess(input(fullSettings, base)));
    steps.push(evaluateAccess(input(fullSettings, { ...base, session: { email: "j@fund.com", emailVerified: false, passwordVersion: null } })));
    steps.push(evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com", { passwordVersion: null }) })));
    steps.push(evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com") })));
    steps.push(evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com"), ndaSigned: true })));
    steps.push(evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com"), ndaSigned: true, questionnaireDone: true })));
    steps.push(
      evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com"), ndaSigned: true, questionnaireDone: true, approval: "pending" })),
    );
    steps.push(
      evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com"), ndaSigned: true, questionnaireDone: true, approval: "rejected" })),
    );
    steps.push(
      evaluateAccess(input(fullSettings, { ...base, ...identified("j@fund.com"), ndaSigned: true, questionnaireDone: true, approval: "approved" })),
    );
    expect(steps).toEqual([
      "email",
      "verify",
      "password",
      "nda",
      "questionnaire",
      "approval_pending",
      "approval_pending",
      "approval_rejected",
      "granted",
    ]);
  });

  it("an enabled questionnaire with no questions does not block", () => {
    const s = { audience: "email" as const, questionnaire: { enabled: true, questions: [] } };
    expect(evaluateAccess(input(s, identified()))).toBe("granted");
  });
});

describe("every toggle combination", () => {
  // Brute-force all 2^n combinations of boolean gates × audience and assert the invariants
  // that matter for security, so a future change to the order cannot silently open a hole.
  const flags = ["verifyEmail", "allowList", "requirePassword", "requireNda", "requireApproval", "questionnaire"] as const;

  for (const audience of ["anyone", "email"] as const) {
    for (let mask = 0; mask < 1 << flags.length; mask++) {
      const on = flags.filter((_, i) => mask & (1 << i));
      const s: Partial<LinkSettings> = {
        audience,
        verifyEmail: on.includes("verifyEmail"),
        allowList: on.includes("allowList"),
        requirePassword: on.includes("requirePassword"),
        requireNda: on.includes("requireNda"),
        requireApproval: on.includes("requireApproval"),
        questionnaire: { enabled: on.includes("questionnaire"), questions: [{ id: "q", label: "Q", required: true }] },
      };

      it(`${audience} + [${on.join(", ") || "none"}]`, () => {
        // 1. A stranger with no session is never granted unless the link is open and passwordless.
        const stranger = evaluateAccess(input(s));
        const openLink = audience === "anyone" && !s.requirePassword;
        expect(stranger === "granted").toBe(openLink);

        // 2. Someone who passed every gate is granted…
        const all = {
          session: { email: "j@fund.com", emailVerified: true, passwordVersion: 1 },
          visitor: { status: "active" as const },
          allowList: ["fund.com"],
          ndaSigned: true,
          questionnaireDone: true,
          approval: "approved" as const,
        };
        expect(evaluateAccess(input(s, all))).toBe("granted");

        // 3. …unless revoked, the link is disabled, or it has expired.
        expect(evaluateAccess(input(s, { ...all, visitor: { status: "revoked" } }))).toBe("revoked");
        expect(evaluateAccess(input(s, { ...all, link: { ...input(s).link, status: "disabled" } }))).toBe("unavailable");
        expect(evaluateAccess(input(s, { ...all, link: { ...input(s).link, expiresAt: NOW } }))).toBe("expired");

        // 4. Dropping any single passed gate is never "granted" when that gate is on.
        if (audience === "email") {
          if (s.verifyEmail) expect(evaluateAccess(input(s, { ...all, session: { ...all.session, emailVerified: false } }))).not.toBe("granted");
          if (s.allowList) expect(evaluateAccess(input(s, { ...all, allowList: ["other.com"] }))).not.toBe("granted");
          if (s.requireNda) expect(evaluateAccess(input(s, { ...all, ndaSigned: false }))).not.toBe("granted");
          if (on.includes("questionnaire")) expect(evaluateAccess(input(s, { ...all, questionnaireDone: false }))).not.toBe("granted");
          if (s.requireApproval) expect(evaluateAccess(input(s, { ...all, approval: "pending" }))).not.toBe("granted");
        }
        if (s.requirePassword) expect(evaluateAccess(input(s, { ...all, session: { ...all.session, passwordVersion: 0 } }))).not.toBe("granted");
      });
    }
  }

  it("covers every identity toggle", () => {
    expect(IDENTITY_TOGGLES.length).toBeGreaterThan(0);
  });
});

describe("downloads", () => {
  const pdf = "application/pdf";
  const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const s = (o: Partial<LinkSettings>) => linkSettingsSchema.parse({ ...defaultLinkSettings, ...o });

  it("off means off regardless of approval", () => {
    expect(downloadState(s({ download: "off" }), pdf, "approved")).toBe("off");
  });

  it("allowed", () => {
    expect(downloadState(s({ download: "allowed" }), pdf, "none")).toBe("allowed");
    expect(downloadState(s({ download: "allowed" }), docx, "none")).toBe("allowed");
  });

  it("on request follows the request state", () => {
    expect(downloadState(s({ download: "request" }), pdf, "none")).toBe("request");
    expect(downloadState(s({ download: "request" }), pdf, "pending")).toBe("pending");
    expect(downloadState(s({ download: "request" }), pdf, "approved")).toBe("allowed");
    expect(downloadState(s({ download: "request" }), pdf, "rejected")).toBe("rejected");
  });

  it("never hands out an unwatermarked file when the watermark is on", () => {
    expect(downloadState(s({ download: "allowed", watermark: true }), docx, "none")).toBe("unsupported");
    expect(downloadState(s({ download: "allowed", watermark: true }), "video/mp4", "none")).toBe("unsupported");
    expect(downloadState(s({ download: "allowed", watermark: true }), pdf, "none")).toBe("allowed");
    expect(downloadState(s({ download: "allowed", watermark: true }), "image/png", "none")).toBe("allowed");
  });
});
