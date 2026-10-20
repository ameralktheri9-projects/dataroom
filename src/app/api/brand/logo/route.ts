import { NextResponse } from "next/server";
import { getBrand } from "@/lib/workspace";
import { storage } from "@/lib/storage";

// The company logo is shown on visitor pages, so it is the one file served without an access check.
export async function GET() {
  const brand = await getBrand();
  if (!brand.logoKey) return new NextResponse(null, { status: 404 });
  const bytes = await storage().get(brand.logoKey);
  const type = brand.logoKey.endsWith(".svg") ? "image/svg+xml" : brand.logoKey.endsWith(".jpg") ? "image/jpeg" : "image/png";
  return new NextResponse(Buffer.from(bytes), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=300", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
}
