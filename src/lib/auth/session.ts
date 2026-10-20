import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Role, User } from "@/lib/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { can, type Permission } from "@/lib/permissions";
import { requestMeta } from "@/lib/request";

const COOKIE = "dr_session";
const SESSION_HOURS = 12;

export type CurrentUser = Pick<User, "id" | "name" | "email" | "role" | "twoFactorEnabled">;

export async function createSession(userId: string, twoFactorPassed: boolean): Promise<void> {
  const db = await getDb();
  const token = randomToken();
  const meta = await requestMeta();
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.insert(schema.sessions).values({
    userId,
    tokenHash: sha256(token),
    twoFactorPassed,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function loadSession() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row || row.user.status !== "active") return null;
  return row;
}

/** Session that has passed the password step but maybe not the second factor. */
export async function getPartialSession() {
  return loadSession();
}

export async function markTwoFactorPassed(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.update(schema.sessions).set({ twoFactorPassed: true }).where(eq(schema.sessions.id, sessionId));
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const row = await loadSession();
  if (!row || !row.session.twoFactorPassed) return null;
  const { id, name, email, role, twoFactorEnabled } = row.user;
  return { id, name, email, role, twoFactorEnabled };
}

/** Use at the top of every admin page and server action. */
export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/?denied=1");
  return user;
}

/** For server actions that return an error instead of redirecting. */
export async function userCan(permission: Permission): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return user && can(user.role, permission) ? user : null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  }
  jar.delete(COOKIE);
}

export async function destroyAllSessionsFor(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export type { Role };
