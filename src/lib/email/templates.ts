import type { Brand } from "@/lib/db/schema";

// Plain, brand-coloured transactional emails (FR-80: brand on emails).

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(brand: Brand, title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden">
<tr><td style="background:${esc(brand.primaryColor)};color:#fff;padding:16px 24px;font-weight:bold;font-size:16px">${esc(brand.companyName)}</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:18px;margin:0 0 16px">${esc(title)}</h1>${bodyHtml}</td></tr>
</table></td></tr></table></body></html>`;
}

function button(brand: Brand, href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${esc(brand.accentColor)};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${esc(label)}</a></p>`;
}

export type Rendered = { subject: string; html: string; text: string };

export function verificationCodeEmail(brand: Brand, code: string): Rendered {
  return {
    subject: `${code} is your ${brand.companyName} access code`,
    html: layout(
      brand,
      "Your access code",
      `<p>Enter this code to open the documents shared with you:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:bold">${esc(code)}</p>
<p style="color:#78716c;font-size:13px">The code expires in 10 minutes. If you did not request it, ignore this email.</p>`,
    ),
    text: `Your access code is ${code}. It expires in 10 minutes.`,
  };
}

export function linkOpenedEmail(
  brand: Brand,
  p: { linkName: string; visitor: string; country: string | null; at: Date; url: string },
): Rendered {
  const where = p.country ? ` from ${p.country}` : "";
  return {
    subject: `${p.visitor} opened "${p.linkName}"`,
    html: layout(
      brand,
      "Your link was opened",
      `<p><strong>${esc(p.visitor)}</strong> opened <strong>${esc(p.linkName)}</strong>${esc(where)} at ${esc(p.at.toUTCString())}.</p>${button(brand, p.url, "View activity")}`,
    ),
    text: `${p.visitor} opened "${p.linkName}"${where} at ${p.at.toUTCString()}. ${p.url}`,
  };
}

export function requestCreatedEmail(
  brand: Brand,
  p: { kind: "access" | "download"; visitor: string; linkName: string; documentName?: string; url: string },
): Rendered {
  const what = p.kind === "access" ? `access to "${p.linkName}"` : `to download "${p.documentName}" from "${p.linkName}"`;
  return {
    subject: `${p.visitor} is asking ${what}`,
    html: layout(brand, "New request", `<p><strong>${esc(p.visitor)}</strong> is asking ${esc(what)}.</p>${button(brand, p.url, "Review request")}`),
    text: `${p.visitor} is asking ${what}. Review: ${p.url}`,
  };
}

export function requestDecidedEmail(
  brand: Brand,
  p: { kind: "access" | "download"; approved: boolean; linkName: string; documentName?: string; url: string },
): Rendered {
  const what = p.kind === "access" ? `access to "${p.linkName}"` : `download of "${p.documentName}"`;
  const verdict = p.approved ? "approved" : "declined";
  return {
    subject: `Your request was ${verdict}`,
    html: layout(
      brand,
      `Request ${verdict}`,
      `<p>Your request for ${esc(what)} was ${verdict}.</p>${p.approved ? button(brand, p.url, "Open documents") : ""}`,
    ),
    text: `Your request for ${what} was ${verdict}.${p.approved ? " " + p.url : ""}`,
  };
}

export function ndaSignedEmail(brand: Brand, p: { agreementName: string; fullName: string; signedAt: Date }): Rendered {
  return {
    subject: `Your signed copy: ${p.agreementName}`,
    html: layout(
      brand,
      "Agreement accepted",
      `<p>Thank you, ${esc(p.fullName)}. You accepted <strong>${esc(p.agreementName)}</strong> on ${esc(p.signedAt.toUTCString())}.</p><p>A signed copy is attached for your records.</p>`,
    ),
    text: `You accepted ${p.agreementName} on ${p.signedAt.toUTCString()}. A signed copy is attached.`,
  };
}

export function inviteEmail(brand: Brand, p: { inviter: string; role: string; url: string }): Rendered {
  return {
    subject: `${p.inviter} invited you to the ${brand.companyName} data room`,
    html: layout(
      brand,
      "You're invited",
      `<p>${esc(p.inviter)} invited you to join as <strong>${esc(p.role)}</strong>.</p>${button(brand, p.url, "Accept invitation")}<p style="color:#78716c;font-size:13px">This invitation expires in 7 days.</p>`,
    ),
    text: `${p.inviter} invited you to join as ${p.role}. Accept: ${p.url} (expires in 7 days)`,
  };
}
