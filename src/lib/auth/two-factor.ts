import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { decrypt, encrypt } from "@/lib/crypto";
import { newTotpSecret } from "./totp";

/** Creates (or reuses) a pending TOTP secret during enrolment. Returns the plain secret for the QR code. */
export async function ensurePendingTotpSecret(userId: string): Promise<string> {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (user.twoFactorSecret && !user.twoFactorEnabled) return decrypt(env().APP_SECRET, user.twoFactorSecret);
  const secret = newTotpSecret();
  await db
    .update(schema.users)
    .set({ twoFactorSecret: encrypt(env().APP_SECRET, secret), twoFactorEnabled: false })
    .where(eq(schema.users.id, userId));
  return secret;
}
