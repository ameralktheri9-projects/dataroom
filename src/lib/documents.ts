import "server-only";
import { and, eq, isNull, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb, schema } from "@/lib/db";
import type { Folder } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { hmac, safeEqual } from "@/lib/crypto";
import { storage } from "@/lib/storage";
import { pdfPageCount } from "@/lib/watermark";

export async function folderBreadcrumb(folderId: string | null): Promise<Folder[]> {
  if (!folderId) return [];
  const db = await getDb();
  const all = await db.select().from(schema.folders);
  const byId = new Map(all.map((f) => [f.id, f]));
  const trail: Folder[] = [];
  let cur = byId.get(folderId);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    trail.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return trail;
}

/** Finds or creates nested folders, e.g. ["Financials", "2026"] under parentId. Used by folder drag-and-drop. */
export async function ensureFolderPath(parentId: string | null, names: string[], userId: string): Promise<string | null> {
  const db = await getDb();
  let current = parentId;
  for (const raw of names) {
    const name = raw.trim().slice(0, 200);
    if (!name) continue;
    const [existing] = await db
      .select()
      .from(schema.folders)
      .where(and(eq(schema.folders.name, name), current ? eq(schema.folders.parentId, current) : isNull(schema.folders.parentId)))
      .limit(1);
    if (existing) {
      current = existing.id;
    } else {
      const [created] = await db.insert(schema.folders).values({ name, parentId: current, createdBy: userId }).returning();
      current = created.id;
    }
  }
  return current;
}

// ---------------------------------------------------------------- upload tickets
// The browser uploads straight to storage. The ticket binds what was authorised (key, size, type, target)
// so /complete cannot be pointed at someone else's object.

export type UploadTicket = {
  key: string;
  name: string;
  mime: string;
  size: number;
  folderId: string | null;
  documentId: string | null; // set when uploading a new version
  userId: string;
  exp: number;
};

export function signTicket(t: UploadTicket): string {
  const body = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${body}.${hmac(env().APP_SECRET, "upload:" + body)}`;
}

export function readTicket(token: string): UploadTicket | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(env().APP_SECRET, "upload:" + body))) return null;
  const t = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as UploadTicket;
  return t.exp * 1000 > Date.now() ? t : null;
}

export function newStorageKey(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) : "bin";
  const d = new Date();
  return `documents/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${nanoid(24)}.${ext}`;
}

/** Records an uploaded file as a new document, or as the next version of an existing one (FR-12). */
export async function recordUpload(t: UploadTicket) {
  const db = await getDb();
  let pageCount: number | null = null;
  if (t.mime === "application/pdf") {
    pageCount = await pdfPageCount(await storage().get(t.key));
  }

  return db.transaction(async (tx) => {
    let documentId = t.documentId;
    if (!documentId) {
      const [doc] = await tx
        .insert(schema.documents)
        .values({ name: t.name, folderId: t.folderId, uploadedBy: t.userId })
        .returning();
      documentId = doc.id;
    }
    const [{ latest }] = await tx
      .select({ latest: max(schema.documentVersions.versionNumber) })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    const [version] = await tx
      .insert(schema.documentVersions)
      .values({
        documentId,
        versionNumber: (latest ?? 0) + 1,
        storageKey: t.key,
        fileName: t.name,
        fileType: t.mime,
        size: t.size,
        pageCount,
        uploadedBy: t.userId,
      })
      .returning();
    await tx.update(schema.documents).set({ currentVersionId: version.id }).where(eq(schema.documents.id, documentId));
    return { documentId, version };
  });
}
