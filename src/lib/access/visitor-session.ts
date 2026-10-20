import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { env } from "@/lib/env";

// Visitors have no accounts (BRD assumption). Their progress through a link's gates is held in a
// signed, HTTP-only cookie per link. Anything revocable (link status, visitor status, approvals,
// NDA signatures) is re-read from the database on every request rather than trusted from here.

export type VisitorSession = {
  linkId: string;
  email: string | null;
  visitorId: string | null;
  emailVerified: boolean;
  passwordVersion: number | null;
  visitId: string | null;
};

const MAX_AGE_SECONDS = 30 * 24 * 3600;

function cookieName(linkId: string) {
  return `dr_v_${linkId.replace(/-/g, "").slice(0, 16)}`;
}

function key() {
  return new TextEncoder().encode(env().APP_SECRET + ":visitor");
}

export function emptySession(linkId: string): VisitorSession {
  return { linkId, email: null, visitorId: null, emailVerified: false, passwordVersion: null, visitId: null };
}

export async function readVisitorSession(linkId: string): Promise<VisitorSession> {
  const raw = (await cookies()).get(cookieName(linkId))?.value;
  if (!raw) return emptySession(linkId);
  try {
    const { payload } = await jwtVerify(raw, key(), { algorithms: ["HS256"] });
    const s = payload as unknown as VisitorSession;
    if (s.linkId !== linkId) return emptySession(linkId);
    return { ...emptySession(linkId), ...s };
  } catch {
    return emptySession(linkId);
  }
}

export async function writeVisitorSession(s: VisitorSession): Promise<void> {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(key());
  (await cookies()).set(cookieName(s.linkId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function clearVisitorSession(linkId: string): Promise<void> {
  (await cookies()).delete(cookieName(linkId));
}
