import { generateSecret, generateURI, verify } from "otplib";
import QRCode from "qrcode";

export function newTotpSecret(): string {
  return generateSecret();
}

export async function totpQrDataUrl(secret: string, email: string, issuer: string): Promise<string> {
  const uri = generateURI({ issuer, label: email, secret });
  return QRCode.toDataURL(uri, { margin: 1, width: 220 });
}

export async function verifyTotp(secret: string, token: string): Promise<boolean> {
  const clean = token.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  try {
    // accept the previous/next 30-second step for clock drift
    const result = await verify({ secret, token: clean, epochTolerance: 30 });
    return result.valid;
  } catch {
    return false;
  }
}
