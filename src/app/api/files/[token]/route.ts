import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { contentDisposition, storage } from "@/lib/storage";
import { verifyFileToken } from "@/lib/storage/signed-token";

// Serves the local storage driver's signed URLs. With STORAGE_DRIVER=s3, browsers talk to S3/R2
// directly and this route is unused.

export async function GET(_: Request, ctx: RouteContext<"/api/files/[token]">) {
  if (env().STORAGE_DRIVER !== "local") return new NextResponse(null, { status: 404 });
  const { token } = await ctx.params;
  const t = verifyFileToken(env().APP_SECRET, token);
  if (!t || t.op !== "get") return new NextResponse("Link expired", { status: 403 });
  try {
    const bytes = await storage().get(t.k);
    const headers: Record<string, string> = {
      "Content-Type": t.ct ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Length": String(bytes.byteLength),
    };
    if (t.dn) headers["Content-Disposition"] = contentDisposition(t.dn);
    return new NextResponse(Buffer.from(bytes), { headers });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}

export async function PUT(req: Request, ctx: RouteContext<"/api/files/[token]">) {
  if (env().STORAGE_DRIVER !== "local") return new NextResponse(null, { status: 404 });
  const { token } = await ctx.params;
  const t = verifyFileToken(env().APP_SECRET, token);
  if (!t || t.op !== "put") return new NextResponse("Upload link expired", { status: 403 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (t.max && bytes.byteLength > t.max) return new NextResponse("Too large", { status: 413 });
  await storage().put(t.k, bytes, t.ct ?? "application/octet-stream");
  return new NextResponse(null, { status: 200 });
}
