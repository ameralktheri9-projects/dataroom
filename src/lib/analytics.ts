import "server-only";
import { and, count, countDistinct, desc, eq, gte, ilike, inArray, lte, sql, sum, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

// FR-52: analytics with filters by date, link, document and visitor.

export type AnalyticsFilters = {
  from: Date | null;
  to: Date | null;
  linkId: string | null;
  documentId: string | null;
  visitor: string | null; // email substring
};

const UUID = /^[0-9a-f-]{36}$/i;

export function parseFilters(sp: Record<string, string | string[] | undefined>): AnalyticsFilters {
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : null);
  const date = (k: string, endOfDay = false) => {
    const v = one(k);
    if (!v) return null;
    const d = new Date(v + (endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z"));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const id = (k: string) => {
    const v = one(k);
    return v && UUID.test(v) ? v : null;
  };
  return { from: date("from"), to: date("to", true), linkId: id("link"), documentId: id("document"), visitor: one("visitor") };
}

async function visitConditions(f: AnalyticsFilters): Promise<SQL[]> {
  const c: SQL[] = [];
  if (f.from) c.push(gte(schema.visits.startedAt, f.from));
  if (f.to) c.push(lte(schema.visits.startedAt, f.to));
  if (f.linkId) c.push(eq(schema.visits.linkId, f.linkId));
  if (f.visitor) c.push(ilike(schema.visitors.email, `%${f.visitor.replace(/[%_]/g, "\\$&")}%`));
  if (f.documentId) {
    const db = await getDb();
    const versions = await db
      .select({ id: schema.documentVersions.id })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, f.documentId));
    const ids = versions.map((v) => v.id);
    c.push(
      ids.length
        ? sql`exists (select 1 from ${schema.viewEvents} ve where ve.visit_id = "visits"."id" and ${inArray(sql`ve.document_version_id`, ids)})`
        : sql`false`,
    );
  }
  return c;
}

export async function analytics(f: AnalyticsFilters, limit = 500) {
  const db = await getDb();
  const where = and(...(await visitConditions(f)));

  const [totals] = await db
    .select({ visits: count(schema.visits.id), visitors: countDistinct(schema.visits.visitorId) })
    .from(schema.visits)
    .leftJoin(schema.visitors, eq(schema.visitors.id, schema.visits.visitorId))
    .where(where);

  const visits = await db
    .select({
      visit: schema.visits,
      visitorEmail: schema.visitors.email,
      visitorId: schema.visitors.id,
      linkName: schema.links.name,
      seconds: sql<number>`coalesce((select sum(ve.seconds_viewed) from ${schema.viewEvents} ve where ve.visit_id = "visits"."id"), 0)`.mapWith(Number),
      documents: sql<number>`(select count(distinct ve.document_version_id) from ${schema.viewEvents} ve where ve.visit_id = "visits"."id")`.mapWith(Number),
      downloads: sql<number>`(select count(*) from ${schema.downloads} d where d.visit_id = "visits"."id")`.mapWith(Number),
    })
    .from(schema.visits)
    .innerJoin(schema.links, eq(schema.links.id, schema.visits.linkId))
    .leftJoin(schema.visitors, eq(schema.visitors.id, schema.visits.visitorId))
    .where(where)
    .orderBy(desc(schema.visits.startedAt))
    .limit(limit);

  const visitIds = visits.map((v) => v.visit.id);
  // skipped for large exports, which only need the visit rows (and would exceed the bind-parameter limit)
  const perDocument = visitIds.length && visitIds.length <= 5000
    ? await db
        .select({
          documentId: schema.documents.id,
          name: schema.documents.name,
          visits: countDistinct(schema.viewEvents.visitId),
          seconds: sum(schema.viewEvents.secondsViewed).mapWith(Number),
        })
        .from(schema.viewEvents)
        .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.viewEvents.documentVersionId))
        .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
        .where(inArray(schema.viewEvents.visitId, visitIds))
        .groupBy(schema.documents.id, schema.documents.name)
        .orderBy(desc(sum(schema.viewEvents.secondsViewed)))
    : [];

  const totalSeconds = visits.reduce((a, v) => a + v.seconds, 0);
  const totalDownloads = visits.reduce((a, v) => a + v.downloads, 0);
  return { totals: { ...totals, seconds: totalSeconds, downloads: totalDownloads }, visits, perDocument, truncated: visits.length === limit };
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const cell = (v: string | number | null | undefined) => {
    let s = v == null ? "" : String(v);
    // neutralise spreadsheet formulas (CSV injection)
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens UTF-8 (Arabic names) correctly
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
