import "server-only";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Document, DocumentVersion, Folder } from "@/lib/db/schema";

// What a link opens (FR-20): chosen files plus everything inside chosen folders, recursively.

export function descendantFolderIds(rootIds: string[], all: Pick<Folder, "id" | "parentId">[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const f of all) {
    if (!f.parentId) continue;
    const list = children.get(f.parentId) ?? [];
    list.push(f.id);
    children.set(f.parentId, list);
  }
  const out = new Set<string>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return out;
}

export type ScopedDocument = { document: Document; version: DocumentVersion };

export type LinkContents = {
  rootFolderIds: string[];
  rootDocumentIds: string[];
  folders: Folder[]; // every folder reachable through the link
  documents: ScopedDocument[]; // every document reachable through the link, with its latest version
};

export async function linkContents(linkId: string): Promise<LinkContents> {
  const db = await getDb();
  const scope = await db.select().from(schema.linkScope).where(eq(schema.linkScope.linkId, linkId));
  const rootFolderIds = scope.flatMap((s) => (s.folderId ? [s.folderId] : []));
  const rootDocumentIds = scope.flatMap((s) => (s.documentId ? [s.documentId] : []));

  const allFolders = rootFolderIds.length ? await db.select().from(schema.folders) : [];
  const folderIds = descendantFolderIds(rootFolderIds, allFolders);
  const folders = allFolders.filter((f) => folderIds.has(f.id));

  const conditions = [];
  if (folderIds.size) conditions.push(inArray(schema.documents.folderId, [...folderIds]));
  if (rootDocumentIds.length) conditions.push(inArray(schema.documents.id, rootDocumentIds));
  if (!conditions.length) return { rootFolderIds, rootDocumentIds, folders, documents: [] };

  // Links always serve the latest version (FR-12).
  const rows = await db
    .select({ document: schema.documents, version: schema.documentVersions })
    .from(schema.documents)
    .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.documents.currentVersionId))
    .where(and(isNotNull(schema.documents.currentVersionId), or(...conditions)));

  rows.sort((a, b) => a.document.name.localeCompare(b.document.name));
  return { rootFolderIds, rootDocumentIds, folders, documents: rows };
}

export async function documentInLink(linkId: string, documentId: string): Promise<ScopedDocument | null> {
  const contents = await linkContents(linkId);
  return contents.documents.find((d) => d.document.id === documentId) ?? null;
}
