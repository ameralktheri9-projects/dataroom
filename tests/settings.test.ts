import { describe, expect, it } from "vitest";
import {
  defaultLinkSettings,
  emailIsAllowed,
  expiryFromPreset,
  isValidAllowEntry,
  linkSettingsSchema,
  validateLinkSettings,
  type LinkSettings,
  type SettingsContext,
} from "@/lib/access/settings";

const NOW = new Date("2026-10-20T12:00:00Z");
const ctx = (o: Partial<SettingsContext> = {}): SettingsContext => ({
  allowListEntries: [],
  hasPassword: false,
  agreementId: null,
  expiresAt: null,
  now: NOW,
  ...o,
});
const s = (o: Partial<LinkSettings>) => linkSettingsSchema.parse({ ...defaultLinkSettings, ...o });

describe("conflicting toggles (FR-22)", () => {
  it("default settings are valid", () => {
    expect(validateLinkSettings(defaultLinkSettings, ctx())).toEqual([]);
  });

  it("blocks Anyone with link + Allowed list (the BRD example)", () => {
    const issues = validateLinkSettings(s({ audience: "anyone", allowList: true }), ctx({ allowListEntries: ["fund.com"] }));
    expect(issues.map((i) => i.field)).toContain("allowList");
  });

  it.each([
    ["verifyEmail", { verifyEmail: true }],
    ["requireNda", { requireNda: true }],
    ["requireApproval", { requireApproval: true }],
    ["questionnaire", { questionnaire: { enabled: true, questions: [{ id: "a", label: "x", required: true }] } }],
    ["download", { download: "request" as const }],
  ])("blocks Anyone with link + %s", (field, over) => {
    const issues = validateLinkSettings(s({ audience: "anyone", ...over }), ctx({ agreementId: "a" }));
    expect(issues.map((i) => i.field)).toContain(field);
  });

  it("allows Anyone with link + password, watermark, screenshot protection and downloads", () => {
    const issues = validateLinkSettings(
      s({ audience: "anyone", requirePassword: true, watermark: true, screenshotProtection: true, download: "allowed" }),
      ctx({ hasPassword: true }),
    );
    expect(issues).toEqual([]);
  });

  it("requires the pieces each gate depends on", () => {
    const fields = (o: Partial<LinkSettings>, c: Partial<SettingsContext> = {}) =>
      validateLinkSettings(s(o), ctx(c)).map((i) => i.field);
    expect(fields({ allowList: true })).toContain("allowListEntries");
    expect(fields({ requirePassword: true })).toContain("password");
    expect(fields({ requireNda: true })).toContain("agreementId");
    expect(fields({ questionnaire: { enabled: true, questions: [] } })).toContain("questionnaire");
    expect(fields({}, { expiresAt: new Date(NOW.getTime() - 1000) })).toContain("expiresAt");
    expect(fields({ allowList: true }, { allowListEntries: ["not an email"] })).toContain("allowListEntries");
  });
});

describe("allowed list entries", () => {
  it("validates entries", () => {
    expect(isValidAllowEntry("jane@fund.com")).toBe(true);
    expect(isValidAllowEntry("@fund.com")).toBe(true);
    expect(isValidAllowEntry("fund.co.uk")).toBe(true);
    expect(isValidAllowEntry("fund")).toBe(false);
    expect(isValidAllowEntry("jane@")).toBe(false);
  });

  it("matches domains without suffix confusion", () => {
    expect(emailIsAllowed("a@fund.com", ["fund.com"])).toBe(true);
    expect(emailIsAllowed("a@eu.fund.com", ["fund.com"])).toBe(true);
    expect(emailIsAllowed("a@notfund.com", ["fund.com"])).toBe(false);
    expect(emailIsAllowed("not-an-email", ["fund.com"])).toBe(false);
  });
});

describe("expiry presets (FR-27)", () => {
  it("computes preset dates", () => {
    expect(expiryFromPreset("never", null, NOW)).toBeNull();
    expect(expiryFromPreset("7", null, NOW)?.toISOString()).toBe("2026-10-27T12:00:00.000Z");
    expect(expiryFromPreset("90", null, NOW)?.toISOString()).toBe("2027-01-18T12:00:00.000Z");
    expect(expiryFromPreset("custom", "2026-12-31T00:00:00Z", NOW)?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(expiryFromPreset("custom", "garbage", NOW)).toBeNull();
  });
});
