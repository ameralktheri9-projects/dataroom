"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { userCan } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { str, type FormState } from "@/lib/form";
import { descendantFolderIds } from "@/lib/access/scope";
import { storage } from "@/lib/storage";

const NOT_ALLOWED: FormState = { error: "You don't have permission to change documents." };

export async function createFolder(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("documents.edit");
  if (!user) return NOT_ALLOWED;
  const name = str(fd, "name").slice(0, 200);
  const parentId = str(fd, "parentId") || null;
  if (!name) return { error: "Enter a folder name." };
  const db = await getDb();
  const [folder] = await db.insert(schema.folders).values({ name, parentId, createdBy: user.id }).returning();
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "folder.create", targetType: "folder", targetId: folder.id, metadata: { name } });
  revalidatePath("/documents");
  return { success: `Folder "${name}" created.` };
}

export async function renameFolder(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("documents.edit");
  if (!user) return NOT_ALLOWED;
  const id = str(fd, "id");
  const name = str(fd, "name").slice(0, 200);
  if (!name) return { error: "Enter a name." };
  const db = await getDb();
  await db.update(schema.folders).set({ name }).where(eq(schema.folders.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "folder.rename", targetType: "folder", targetId: id, metadata: { name } });
  revalidatePath("/documents");
  return { success: "Renamed." };
}

async function removeStoredVersions(documentIds: string[]) {
  if (!documentIds.length) return;
  const db = await getDb();
  for (const id of documentIds) {
    const versions = await db.select().from(schema.documentVersions).where(eq(schema.documentVersions.documentId, id));
    for (const v of versions) await storage().remove(v.storageKey).catch(() => undefined);
  }
}

export async function deleteFolder(fd: FormData): Promise<void> {
  const user = await userCan("documents.edit");
  if (!user) return;
  const id = str(fd, "id");
  const db = await getDb();
  const [folder] = await db.select().from(schema.folders).where(eq(schema.folders.id, id)).limit(1);
  if (!folder) return;
  const all = await db.select({ id: schema.folders.id, parentId: schema.folders.parentId }).from(schema.folders);
  const ids = descendantFolderIds([id], all);
  const docs = (await db.select({ id: schema.documents.id, folderId: schema.documents.folderId }).from(schema.documents)).filter(
    (d) => d.folderId && ids.has(d.folderId),
  );
  await removeStoredVersions(docs.map((d) => d.id));
  await db.delete(schema.folders).where(eq(schema.folders.id, id)); // cascades to sub-folders, documents, versions, link scope
  await audit({
    actor: { type: "user", id: user.id, label: user.email },
    action: "folder.delete",
    targetType: "folder",
    targetId: id,
    metadata: { name: folder.name, documents: docs.length },
  });
  revalidatePath("/documents");
  redirect(folder.parentId ? `/documents?folder=${folder.parentId}` : "/documents");
}

export async function renameDocument(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("documents.edit");
  if (!user) return NOT_ALLOWED;
  const id = str(fd, "id");
  const name = str(fd, "name").slice(0, 255);
  if (!name) return { error: "Enter a name." };
  const db = await getDb();
  await db.update(schema.documents).set({ name }).where(eq(schema.documents.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "document.rename", targetType: "document", targetId: id, metadata: { name } });
  revalidatePath("/documents");
  return { success: "Renamed." };
}

export async function deleteDocument(fd: FormData): Promise<void> {
  const user = await userCan("documents.edit");
  if (!user) return;
  const id = str(fd, "id");
  const db = await getDb();
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  if (!doc) return;
  await removeStoredVersions([id]);
  await db.update(schema.documents).set({ currentVersionId: null }).where(eq(schema.documents.id, id));
  await db.delete(schema.documents).where(eq(schema.documents.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "document.delete", targetType: "document", targetId: id, metadata: { name: doc.name } });
  revalidatePath("/documents");
  redirect(doc.folderId ? `/documents?folder=${doc.folderId}` : "/documents");
}
