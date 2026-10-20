"use server";

import { redirect } from "next/navigation";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt, sha256 } from "@/lib/crypto";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import {
  createSession,
  destroySession,
  getPartialSession,
  markTwoFactorPassed,
} from "@/lib/auth/session";
import { LIMITS, rateLimit, RateLimitError } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { requestMeta } from "@/lib/request";
import { getWorkspaceSettings } from "@/lib/workspace";
import { normalizeEmail, str, type FormState } from "@/lib/form";
import { isValidEmail } from "@/lib/access/settings";

function limited(err: unknown): FormState {
  if (err instanceof RateLimitError) return { error: `Too many attempts. Try again in ${Math.ceil(err.retryAfterSeconds / 60)} min.` };
  throw err;
}

/** First-run: create the Owner account. Only works while there are no users. */
export async function setupOwner(_: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n > 0) return { error: "Setup is already complete. Sign in instead." };

  const name = str(fd, "name");
  const email = normalizeEmail(str(fd, "email"));
  const company = str(fd, "company");
  const password = String(fd.get("password") ?? "");
  if (!name) return { error: "Enter your name." };
  if (!isValidEmail(email)) return { error: "Enter a valid email." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const [user] = await db
    .insert(schema.users)
    .values({ name, email, passwordHash: await hashPassword(password), role: "owner", status: "active" })
    .returning();

  const ws = await getWorkspaceSettings();
  if (company) {
    await db.update(schema.settings).set({ brand: { ...ws.brand, companyName: company } }).where(eq(schema.settings.id, ws.id));
  }

  await audit({ actor: { type: "user", id: user.id, label: email }, action: "workspace.setup", targetType: "user", targetId: user.id });
  await createSession(user.id, false);
  redirect("/login/setup-2fa");
}

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const email = normalizeEmail(str(fd, "email"));
  const password = String(fd.get("password") ?? "");
  const meta = await requestMeta();
  try {
    await rateLimit(`login:ip:${meta.ip ?? "unknown"}`, LIMITS.login.limit * 3, LIMITS.login.window);
    await rateLimit(`login:email:${email}`, LIMITS.login.limit, LIMITS.login.window);
  } catch (err) {
    return limited(err);
  }

  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  const ok = user && user.status === "active" && (await verifyPassword(password, user.passwordHash));
  if (!ok) {
    await audit({ actor: { type: "user", id: user?.id ?? null, label: email }, action: "auth.login_failed" });
    return { error: "Email or password is incorrect." };
  }

  await createSession(user.id, false);
  redirect(user.twoFactorEnabled ? "/login/verify" : "/login/setup-2fa");
}

export async function verifyTwoFactor(_: FormState, fd: FormData): Promise<FormState> {
  const row = await getPartialSession();
  if (!row) redirect("/login");
  try {
    await rateLimit(`2fa:${row.user.id}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.window);
  } catch (err) {
    return limited(err);
  }
  const secret = row.user.twoFactorSecret ? decrypt(env().APP_SECRET, row.user.twoFactorSecret) : null;
  if (!secret || !row.user.twoFactorEnabled) redirect("/login/setup-2fa");
  if (!(await verifyTotp(secret, str(fd, "code")))) return { error: "That code is not valid. Check your authenticator app." };

  await markTwoFactorPassed(row.session.id);
  const db = await getDb();
  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, row.user.id));
  await audit({ actor: { type: "user", id: row.user.id, label: row.user.email }, action: "auth.login" });
  redirect("/");
}

export async function confirmTwoFactorSetup(_: FormState, fd: FormData): Promise<FormState> {
  const row = await getPartialSession();
  if (!row) redirect("/login");
  if (row.user.twoFactorEnabled) redirect(row.session.twoFactorPassed ? "/" : "/login/verify");
  try {
    await rateLimit(`2fa:${row.user.id}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.window);
  } catch (err) {
    return limited(err);
  }
  if (!row.user.twoFactorSecret) return { error: "Reload the page to get a new QR code." };
  const secret = decrypt(env().APP_SECRET, row.user.twoFactorSecret);
  if (!(await verifyTotp(secret, str(fd, "code")))) return { error: "That code is not valid. Try the newest code in your app." };

  const db = await getDb();
  await db.update(schema.users).set({ twoFactorEnabled: true, lastLoginAt: new Date() }).where(eq(schema.users.id, row.user.id));
  await markTwoFactorPassed(row.session.id);
  await audit({ actor: { type: "user", id: row.user.id, label: row.user.email }, action: "auth.2fa_enabled" });
  redirect("/");
}

export async function acceptInvite(_: FormState, fd: FormData): Promise<FormState> {
  const token = str(fd, "token");
  const name = str(fd, "name");
  const password = String(fd.get("password") ?? "");
  if (!name) return { error: "Enter your name." };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  const db = await getDb();
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .limit(1);
  if (!invite) return { error: "This invitation is invalid or has expired. Ask for a new one." };

  const passwordHash = await hashPassword(password);
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email)).limit(1);
  let userId: string;
  if (existing) {
    if (existing.status === "active") return { error: "This email already has an account. Sign in instead." };
    await db
      .update(schema.users)
      .set({ name, passwordHash, role: invite.role, status: "active", twoFactorEnabled: false, twoFactorSecret: null })
      .where(eq(schema.users.id, existing.id));
    userId = existing.id;
  } else {
    const [u] = await db
      .insert(schema.users)
      .values({ name, email: invite.email, passwordHash, role: invite.role, status: "active" })
      .returning();
    userId = u.id;
  }
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  await audit({ actor: { type: "user", id: userId, label: invite.email }, action: "team.invite_accepted", targetType: "user", targetId: userId });
  await createSession(userId, false);
  redirect("/login/setup-2fa");
}

export async function logout(): Promise<void> {
  await destroySession();
  redirect("/login");
}
