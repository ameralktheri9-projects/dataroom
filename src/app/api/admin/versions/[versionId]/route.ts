import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

// Team preview/download of a stored version. Redirects to a 5-minute signed URL.
export async function GET(req: Request, ctx: RouteContext<"/api/admin/versions/[versionId]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { versionId } = await ctx.params;
  const db = await getDb();
  const [v] = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.id, versionId)).limit(1);
  if (!v) return new NextResponse("Not found", { status: 404 });
  const download = new URL(req.url).searchParams.has("download");
  const url = await storage().readUrl(v.storageKey, {
    contentType: v.fileType,
    downloadName: download ? v.fileName : undefined,
  });
  return NextResponse.redirect(new URL(url, req.url), { headers: { "Cache-Control": "private, no-store" } });
}
