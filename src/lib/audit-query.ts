import "server-only";
import { and, desc, gte, ilike, lte, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type AuditFilters = { q: string; from: Date | null; to: Date | null };

export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const d = (k: string, end = false) => {
    const v = s(k);
    if (!v) return null;
    const date = new Date(v + (end ? "T23:59:59.999Z" : "T00:00:00.000Z"));
    return Number.isNaN(date.getTime()) ? null : date;
  };
  return { q: s("q"), from: d("from"), to: d("to", true) };
}

export async function queryAudit(f: AuditFilters, limit: number, offset = 0) {
  const db = await getDb();
  const c: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    c.push(or(ilike(schema.auditLog.action, like), ilike(schema.auditLog.actorLabel, like), ilike(schema.auditLog.ip, like))!);
  }
  if (f.from) c.push(gte(schema.auditLog.createdAt, f.from));
  if (f.to) c.push(lte(schema.auditLog.createdAt, f.to));
  return db
    .select()
    .from(schema.auditLog)
    .where(c.length ? and(...c) : undefined)
    .orderBy(desc(schema.auditLog.createdAt))
    .limit(limit)
    .offset(offset);
}
