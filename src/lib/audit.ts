import "server-only";
import { getDb, schema } from "@/lib/db";
import { requestMeta } from "@/lib/request";

export type AuditActor =
  | { type: "user"; id: string | null; label: string }
  | { type: "visitor"; id: string | null; label: string | null }
  | { type: "system" };

export type AuditEntry = {
  actor: AuditActor;
  action: string; // e.g. "link.create", "visitor.revoke", "document.view"
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/** Append to the insert-only audit log (FR-55, NFR-12). */
export async function audit(entry: AuditEntry): Promise<void> {
  const db = await getDb();
  const ip = entry.ip !== undefined ? entry.ip : (await requestMeta()).ip;
  await db.insert(schema.auditLog).values({
    actorType: entry.actor.type,
    actorId: entry.actor.type === "system" ? null : entry.actor.id,
    actorLabel: entry.actor.type === "system" ? "system" : entry.actor.label,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? null,
    ip,
  });
}
