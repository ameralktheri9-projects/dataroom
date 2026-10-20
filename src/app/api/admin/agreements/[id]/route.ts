import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(req: Request, ctx: RouteContext<"/api/admin/agreements/[id]">) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const db = await getDb();
  const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, id)).limit(1);
  if (!a) return new NextResponse("Not found", { status: 404 });
  const url = await storage().readUrl(a.storageKey, { contentType: "application/pdf" });
  return NextResponse.redirect(new URL(url, req.url));
}
