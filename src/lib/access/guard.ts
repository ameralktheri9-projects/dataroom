import "server-only";
import { findLinkBySlug, resolveAccess, type ResolvedAccess } from "./resolve";
import { documentInLink, type ScopedDocument } from "./scope";
import { currentVisit } from "./visit";

export type GrantedDocument = ResolvedAccess & {
  doc: ScopedDocument;
  visit: NonNullable<Awaited<ReturnType<typeof currentVisit>>>;
};

/**
 * The single check every visitor file endpoint goes through (NFR-02):
 * link live → all gates passed → visitor not revoked → document inside this link's scope → active visit.
 */
export async function grantedDocument(slug: string, documentId: string): Promise<GrantedDocument | null> {
  const link = await findLinkBySlug(slug);
  if (!link) return null;
  const access = await resolveAccess(link);
  if (access.step !== "granted") return null;
  const visit = await currentVisit(access.session);
  if (!visit) return null;
  const doc = await documentInLink(link.id, documentId);
  if (!doc) return null;
  return { ...access, doc, visit };
}
