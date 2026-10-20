"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Link } from "@/lib/db/schema";
import { audit } from "@/lib/audit";
import { numericCode, sha256 } from "@/lib/crypto";
import { verifyPassword } from "@/lib/auth/password";
import { sendEmail } from "@/lib/email";
import { ndaSignedEmail, verificationCodeEmail } from "@/lib/email/templates";
import { LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { storage } from "@/lib/storage";
import { buildSignedPdf } from "@/lib/nda";
import { getBrand } from "@/lib/workspace";
import { normalizeEmail, str, type FormState } from "@/lib/form";
import { isValidEmail } from "@/lib/access/settings";
import type { GateStep } from "@/lib/access/engine";
import { findLinkBySlug, latestRequest, resolveAccess } from "@/lib/access/resolve";
import { documentInLink } from "@/lib/access/scope";
import { clearVisitorSession, writeVisitorSession } from "@/lib/access/visitor-session";
import { notifyRequest } from "@/lib/notify";
import { LANG_COOKIE, visitorLang } from "@/lib/i18n/server";

const CODE_TTL_MS = 10 * 60 * 1000;

/** Loads the link and confirms the visitor is at `expected`, so gates cannot be skipped or done out of order. */
async function atStep(slug: string, expected: GateStep[]) {
  const link = await findLinkBySlug(slug);
  if (!link) redirect(`/v/${slug}`);
  const access = await resolveAccess(link);
  if (!expected.includes(access.step)) redirect(`/v/${slug}`);
  return access;
}

async function rateLimited<T>(fn: () => Promise<T>): Promise<T | FormState> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RateLimitError) return { error: (await visitorLang()).t.errors.rate };
    throw err;
  }
}

async function sendCode(link: Link, email: string) {
  const db = await getDb();
  const code = numericCode();
  await db.insert(schema.verificationCodes).values({
    email,
    linkId: link.id,
    codeHash: sha256(`${link.id}:${email}:${code}`),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  const msg = verificationCodeEmail(await getBrand(), code);
  await sendEmail({ to: email, ...msg });
}

// ---------------------------------------------------------------- email

export async function submitEmail(_: FormState, fd: FormData): Promise<FormState> {
  const slug = str(fd, "slug");
  const { t } = await visitorLang();
  const { link, session } = await atStep(slug, ["email"]);
  const email = normalizeEmail(str(fd, "email"));
  const name = str(fd, "name").slice(0, 200) || null;
  const company = str(fd, "company").slice(0, 200) || null;
  if (!isValidEmail(email)) return { error: t.errors.email };

  const db = await getDb();
  const [visitor] = await db
    .insert(schema.visitors)
    .values({ email, name, company })
    .onConflictDoUpdate({
      target: schema.visitors.email,
      // keep earlier details unless new ones were given
      set: { ...(name ? { name } : {}), ...(company ? { company } : {}), updatedAt: new Date() },
    })
    .returning();

  if (link.settings.verifyEmail) {
    const limited = await rateLimited(async () => {
      await rateLimit(`code:send:${link.id}:${email}`, LIMITS.sendCode.limit, LIMITS.sendCode.window);
      await sendCode(link, email);
    });
    if (limited) return limited as FormState;
  }

  await writeVisitorSession({ ...session, email, visitorId: visitor.id, emailVerified: false, visitId: null });
  await audit({ actor: { type: "visitor", id: visitor.id, label: email }, action: "visitor.email_entered", targetType: "link", targetId: link.id });
  redirect(`/v/${slug}`);
}

export async function verifyCode(_: FormState, fd: FormData): Promise<FormState> {
  const slug = str(fd, "slug");
  const { t } = await visitorLang();
  const { link, session } = await atStep(slug, ["verify"]);
  const email = session.email!;
  const code = str(fd, "code").replace(/\s/g, "");

  const limited = await rateLimited(() => rateLimit(`code:check:${link.id}:${email}`, LIMITS.checkCode.limit, LIMITS.checkCode.window));
  if (limited) return limited as FormState;

  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.verificationCodes)
    .where(
      and(
        eq(schema.verificationCodes.email, email),
        eq(schema.verificationCodes.linkId, link.id),
        isNull(schema.verificationCodes.usedAt),
        gt(schema.verificationCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.verificationCodes.createdAt))
    .limit(1);

  if (!row || row.attempts >= 5 || row.codeHash !== sha256(`${link.id}:${email}:${code}`)) {
    if (row) await db.update(schema.verificationCodes).set({ attempts: row.attempts + 1 }).where(eq(schema.verificationCodes.id, row.id));
    return { error: t.errors.code };
  }
  await db.update(schema.verificationCodes).set({ usedAt: new Date() }).where(eq(schema.verificationCodes.id, row.id));
  await writeVisitorSession({ ...session, emailVerified: true });
  await audit({ actor: { type: "visitor", id: session.visitorId, label: email }, action: "visitor.email_verified", targetType: "link", targetId: link.id });
  redirect(`/v/${slug}`);
}

export async function resendCode(_: FormState, fd: FormData): Promise<FormState> {
  const slug = str(fd, "slug");
  const { t } = await visitorLang();
  const { link, session } = await atStep(slug, ["verify"]);
  const limited = await rateLimited(async () => {
    await rateLimit(`code:send:${link.id}:${session.email}`, LIMITS.sendCode.limit, LIMITS.sendCode.window);
    await sendCode(link, session.email!);
  });
  if (limited) return limited as FormState;
  return { success: t.codeSent };
}

export async function changeEmail(fd: FormData): Promise<void> {
  const slug = str(fd, "slug");
  const link = await findLinkBySlug(slug);
  if (link) await clearVisitorSession(link.id);
  redirect(`/v/${slug}`);
}

// ---------------------------------------------------------------- password

export async function submitPassword(_: FormState, fd: FormData): Promise<FormState> {
  const slug = str(fd, "slug");
  const { t } = await visitorLang();
  const { link, session } = await atStep(slug, ["password"]);
  const meta = await requestMeta();
  const limited = await rateLimited(() =>
    rateLimit(`linkpw:${link.id}:${session.email ?? meta.ip ?? "anon"}`, LIMITS.linkPassword.limit, LIMITS.linkPassword.window),
  );
  if (limited) return limited as FormState;

  if (!(await verifyPassword(String(fd.get("password") ?? ""), link.passwordHash))) {
    await audit({ actor: { type: "visitor", id: session.visitorId, label: session.email }, action: "visitor.password_failed", targetType: "link", targetId: link.id });
    return { error: t.errors.password };
  }
  await writeVisitorSession({ ...session, passwordVersion: link.passwordVersion });
  redirect(`/v/${slug}`);
}

// ---------------------------------------------------------------- NDA (FR-61)

export async function signNda(_: FormState, fd: FormData): Promise<FormState> {
  const slug = str(fd, "slug");
  const { t } = await visitorLang();
  const { link, session, visitor } = await atStep(slug, ["nda"]);
  const fullName = str(fd, "fullName").slice(0, 200);
  const company = str(fd, "company").slice(0, 200) || visitor?.company || null;
  if (fullName.length < 2) return { error: t.errors.name };
  if (fd.get("agree") !== "on") return { error: t.errors.agree };
  if (!visitor || !link.agreementId) return { error: t.errors.generic };

  const db = await getDb();
  const [agreement] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, link.agreementId)).limit(1);
  if (!agreement) return { error: t.errors.generic };
  const meta = await requestMeta();

  const [sig] = await db
    .insert(schema.signatures)
    .values({ agreementId: agreement.id, visitorId: visitor.id, linkId: link.id, fullName, email: visitor.email, company, ip: meta.ip })
    .returning();

  // Signed copy: agreement + acceptance certificate. Failure here must not lose the signature record.
  try {
    const pdf = await buildSignedPdf(await storage().get(agreement.storageKey), {
      agreementName: agreement.name,
      agreementVersion: agreement.version,
      fullName,
      email: visitor.email,
      company,
      ip: meta.ip,
      signedAt: sig.signedAt,
      signatureId: sig.id,
    });
    const key = `signatures/${sig.id}.pdf`;
    await storage().put(key, pdf, "application/pdf");
    await db.update(schema.signatures).set({ signedPdfKey: key }).where(eq(schema.signatures.id, sig.id));
    const msg = ndaSignedEmail(await getBrand(), { agreementName: agreement.name, fullName, signedAt: sig.signedAt });
    await sendEmail({ to: visitor.email, ...msg, attachments: [{ filename: `${agreement.name} - signed.pdf`, content: pdf }] });
  } catch (err) {
    console.error("[nda] signed copy failed", err);
  }

  if (!visitor.name || (company && !visitor.company)) {
    await db
      .update(schema.visitors)
      .set({ name: visitor.name ?? fullName, company: visitor.company ?? company })
      .where(eq(schema.visitors.id, visitor.id));
  }
  await audit({
    actor: { type: "visitor", id: visitor.id, label: visitor.email },
    action: "visitor.nda_signed",
    targetType: "agreement",
    targetId: agreement.id,
    metadata: { linkId: link.id, signatureId: sig.id, version: agreement.version },
    ip: meta.ip,
  });
  await writeVisitorSession(session);
  redirect(`/v/${slug}`);
}

// ---------------------------------------------------------------- questionnaire

export async function submitQuestionnaire(_: FormState, fd: FormData): Promise<FormState> {
  const slug = str(fd, "slug");
  const { t } = await visitorLang();
  const { link, visitor } = await atStep(slug, ["questionnaire"]);
  if (!visitor) return { error: t.errors.generic };
  const answers: Record<string, string> = {};
  for (const q of link.settings.questionnaire.questions) {
    const a = str(fd, `q_${q.id}`).slice(0, 2000);
    if (q.required && !a) return { error: t.errors.required };
    answers[q.label] = a;
  }
  const db = await getDb();
  await db
    .insert(schema.questionnaireAnswers)
    .values({ visitorId: visitor.id, linkId: link.id, answers })
    .onConflictDoUpdate({
      target: [schema.questionnaireAnswers.visitorId, schema.questionnaireAnswers.linkId],
      set: { answers },
    });
  await audit({ actor: { type: "visitor", id: visitor.id, label: visitor.email }, action: "visitor.questionnaire", targetType: "link", targetId: link.id });
  redirect(`/v/${slug}`);
}

// ---------------------------------------------------------------- manual approval

/** Called automatically when a visitor reaches the approval step for the first time. */
export async function requestAccess(fd: FormData): Promise<void> {
  const slug = str(fd, "slug");
  const { link, visitor } = await atStep(slug, ["approval_pending"]);
  if (!visitor) redirect(`/v/${slug}`);
  const existing = await latestRequest(visitor.id, link.id, "access");
  if (!existing) {
    const db = await getDb();
    await db.insert(schema.accessRequests).values({ visitorId: visitor.id, linkId: link.id, type: "access" });
    await audit({ actor: { type: "visitor", id: visitor.id, label: visitor.email }, action: "request.access", targetType: "link", targetId: link.id });
    await notifyRequest(link, { kind: "access", visitor: visitor.email });
  }
  redirect(`/v/${slug}`);
}

export async function requestDownload(fd: FormData): Promise<void> {
  const slug = str(fd, "slug");
  const documentId = str(fd, "documentId");
  const { link, visitor } = await atStep(slug, ["granted"]);
  if (!visitor || link.settings.download !== "request") redirect(`/v/${slug}`);
  const doc = await documentInLink(link.id, documentId);
  if (!doc) redirect(`/v/${slug}`);
  // one request per document; a rejected request stays rejected
  const existing = await latestRequest(visitor.id, link.id, "download", documentId);
  if (!existing) {
    const db = await getDb();
    await db.insert(schema.accessRequests).values({ visitorId: visitor.id, linkId: link.id, type: "download", documentId });
    await audit({
      actor: { type: "visitor", id: visitor.id, label: visitor.email },
      action: "request.download",
      targetType: "document",
      targetId: documentId,
      metadata: { linkId: link.id },
    });
    await notifyRequest(link, { kind: "download", visitor: visitor.email, documentName: doc.document.name });
  }
  redirect(`/v/${slug}/d/${documentId}`);
}

// ---------------------------------------------------------------- language

export async function setLanguage(fd: FormData): Promise<void> {
  const lang = str(fd, "lang") === "ar" ? "ar" : "en";
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 365 * 24 * 3600, sameSite: "lax" });
  const back = str(fd, "back");
  redirect(back.startsWith("/v/") ? back : "/");
}
