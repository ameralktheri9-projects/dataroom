import "server-only";
import { headers } from "next/headers";

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  device: string;
};

export function deviceFromUserAgent(ua: string | null): string {
  if (!ua) return "Unknown";
  if (/iPad|Tablet/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|Android/i.test(ua)) return "Mobile";
  return "Desktop";
}

export function metaFromHeaders(h: Headers): RequestMeta {
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const userAgent = h.get("user-agent");
  // Vercel sets this header in production; empty locally.
  const country = h.get("x-vercel-ip-country") || null;
  return { ip, userAgent, country, device: deviceFromUserAgent(userAgent) };
}

export async function requestMeta(): Promise<RequestMeta> {
  return metaFromHeaders(await headers());
}
