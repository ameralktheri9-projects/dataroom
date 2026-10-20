import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { userCan } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { MAX_UPLOAD_BYTES, storage, URL_TTL_SECONDS } from "@/lib/storage";
import { ensureFolderPath, newStorageKey, signTicket } from "@/lib/documents";
import { resolveMime } from "@/lib/utils";

const body = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.string().max(200),
  size: z.number().int().positive(),
  folderId: z.string().uuid().nullable(),
  // for folder drag-and-drop: sub-folders relative to folderId, e.g. ["Financials", "2026"]
  path: z.array(z.string().max(200)).max(20).default([]),
  documentId: z.string().uuid().nullable().default(null),
});

export async function POST(req: Request) {
  const user = await userCan("documents.edit");
  if (!user) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { name, type, size, path, documentId } = parsed.data;

  const mime = resolveMime(type, name);
  if (!mime) return NextResponse.json({ error: `${name}: this file type is not supported.` }, { status: 415 });
  if (size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `${name}: files must be under 500 MB.` }, { status: 413 });

  const db = await getDb();
  let folderId = parsed.data.folderId;
  if (documentId) {
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1);
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
    folderId = doc.folderId;
  } else {
    if (folderId) {
      const [f] = await db.select({ id: schema.folders.id }).from(schema.folders).where(eq(schema.folders.id, folderId)).limit(1);
      if (!f) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (path.length) folderId = await ensureFolderPath(folderId, path, user.id);
  }

  const key = newStorageKey(name);
  const target = await storage().uploadUrl(key, mime);
  const ticket = signTicket({
    key,
    name,
    mime,
    size,
    folderId,
    documentId,
    userId: user.id,
    exp: Math.floor(Date.now() / 1000) + URL_TTL_SECONDS * 6,
  });
  return NextResponse.json({ ...target, ticket });
}
