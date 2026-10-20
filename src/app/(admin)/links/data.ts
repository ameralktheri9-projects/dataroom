import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { TreeDoc, TreeFolder } from "./link-form";

export async function formData() {
  const db = await getDb();
  const folders: TreeFolder[] = await db
    .select({ id: schema.folders.id, name: schema.folders.name, parentId: schema.folders.parentId })
    .from(schema.folders);
  const documents: TreeDoc[] = await db
    .select({ id: schema.documents.id, name: schema.documents.name, folderId: schema.documents.folderId })
    .from(schema.documents);
  const agreements = await db
    .select({ id: schema.agreements.id, name: schema.agreements.name, version: schema.agreements.version })
    .from(schema.agreements)
    .where(eq(schema.agreements.isCurrent, true))
    .orderBy(desc(schema.agreements.createdAt));
  return { folders, documents, agreements };
}
