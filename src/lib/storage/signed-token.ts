import { hmac, safeEqual } from "@/lib/crypto";

// Self-contained signed tokens for the local storage driver's file URLs.
// The S3 driver uses S3's own presigned URLs instead.

export type FileTokenPayload = {
  k: string; // storage key
  op: "get" | "put";
  exp: number; // unix seconds
  ct?: string; // content type
  dn?: string; // download file name (sets Content-Disposition: attachment)
  max?: number; // max upload bytes
};

export function signFileToken(secret: string, payload: FileTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${hmac(secret, "file:" + body)}`;
}

export function verifyFileToken(secret: string, token: string, now = Date.now()): FileTokenPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (!safeEqual(sig, hmac(secret, "file:" + body))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as FileTokenPayload;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}
