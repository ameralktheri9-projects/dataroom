import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(req: Request, ctx: RouteContext<"/api/admin/signatures/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const db = await getDb();
  const [s] = await db.select().from(schema.signatures).where(eq(schema.signatures.id, id)).limit(1);
  if (!s?.signedPdfKey) return new NextResponse("Not found", { status: 404 });
  const url = await storage().readUrl(s.signedPdfKey, { contentType: "application/pdf", downloadName: `signed-${s.email}-${s.id.slice(0, 8)}.pdf` });
  return NextResponse.redirect(new URL(url, req.url));
}
