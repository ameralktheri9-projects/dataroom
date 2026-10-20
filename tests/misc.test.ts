import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { assignableRoles, can } from "@/lib/permissions";
import { signFileToken, verifyFileToken } from "@/lib/storage/signed-token";
import { decrypt, encrypt } from "@/lib/crypto";
import { watermarkPdf, watermarkText } from "@/lib/watermark";
import { descendantFolderIds } from "@/lib/access/scope";
import { buildSignedPdf } from "@/lib/nda";

const SECRET = "x".repeat(40);

describe("permissions (BRD §4)", () => {
  it("matches the role matrix", () => {
    expect(can("editor", "documents.edit")).toBe(true);
    expect(can("viewer", "documents.edit")).toBe(false);
    expect(can("viewer", "analytics.view")).toBe(true);
    expect(can("editor", "visitors.manage")).toBe(false);
    expect(can("admin", "workspace.manage")).toBe(true);
    expect(can("admin", "workspace.delete")).toBe(false);
    expect(can("owner", "workspace.delete")).toBe(true);
  });

  it("only the owner can create admins", () => {
    expect(assignableRoles("owner")).toContain("admin");
    expect(assignableRoles("admin")).not.toContain("admin");
    expect(assignableRoles("editor")).toEqual([]);
  });
});

describe("signed file tokens (NFR-02)", () => {
  it("round-trips and rejects tampering and expiry", () => {
    const now = Date.now();
    const t = signFileToken(SECRET, { k: "a/b.pdf", op: "get", exp: Math.floor(now / 1000) + 300 });
    expect(verifyFileToken(SECRET, t, now)?.k).toBe("a/b.pdf");
    expect(verifyFileToken("y".repeat(40), t, now)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ k: "other.pdf", op: "get", exp: 9e9 })).toString("base64url");
    expect(verifyFileToken(SECRET, `${forged}.${sig}`, now)).toBeNull();
    expect(verifyFileToken(SECRET, `${body}.${sig}`, now + 301_000)).toBeNull();
  });
});

describe("crypto", () => {
  it("encrypts and decrypts", () => {
    const enc = encrypt(SECRET, "JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decrypt(SECRET, enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decrypt("z".repeat(40), enc)).toThrow();
  });
});

describe("watermark", () => {
  it("includes email, time and IP", () => {
    const t = watermarkText({ email: "j@fund.com", ip: "1.2.3.4", at: new Date("2026-10-20T12:34:56Z") });
    expect(t).toBe("j@fund.com · 2026-10-20 12:34 UTC · 1.2.3.4");
  });

  it("stamps every page of a PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.addPage();
    const out = await watermarkPdf(await doc.save(), { email: "j@fund.com", ip: null, at: new Date() });
    const reloaded = await PDFDocument.load(out);
    expect(reloaded.getPageCount()).toBe(2);
    expect(out.byteLength).toBeGreaterThan((await doc.save()).byteLength);
  });

  it("builds a signed NDA copy with a certificate page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const out = await buildSignedPdf(await doc.save(), {
      agreementName: "Mutual NDA",
      agreementVersion: 2,
      fullName: "Jane Investor",
      email: "j@fund.com",
      company: "Fund",
      ip: "1.2.3.4",
      signedAt: new Date(),
      signatureId: "abc",
    });
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2);
  });
});

describe("link scope", () => {
  it("includes nested folders and handles cycles", () => {
    const folders = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
      { id: "d", parentId: null },
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    expect([...descendantFolderIds(["a"], folders)].sort()).toEqual(["a", "b", "c"]);
    expect([...descendantFolderIds(["b"], folders)].sort()).toEqual(["b", "c"]);
    expect([...descendantFolderIds(["x"], folders)].sort()).toEqual(["x", "y"]);
    expect([...descendantFolderIds([], folders)]).toEqual([]);
  });
});
