import Link from "next/link";
import { asc, desc, isNull } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { analytics, parseFilters } from "@/lib/analytics";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { Button, Card, CardHeader, EmptyState, Input, LinkButton, PageHeader, Select, StatCard, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  await requireUser("analytics.view");
  const sp = await searchParams;
  const f = parseFilters(sp);
  const db = await getDb();
  const [links, documents] = await Promise.all([
    db.select({ id: schema.links.id, name: schema.links.name }).from(schema.links).where(isNull(schema.links.deletedAt)).orderBy(desc(schema.links.createdAt)),
    db.select({ id: schema.documents.id, name: schema.documents.name }).from(schema.documents).orderBy(asc(schema.documents.name)),
  ]);
  const data = await analytics(f);
  const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : []))).toString();

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Every visit, page view and download."
        actions={<LinkButton variant="secondary" href={`/api/analytics/export?${qs}`} prefetch={false}>Export CSV</LinkButton>}
      />

      <Card className="mb-6 p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
          <label className="text-xs font-medium text-stone-600">
            From
            <Input type="date" name="from" defaultValue={typeof sp.from === "string" ? sp.from : ""} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            To
            <Input type="date" name="to" defaultValue={typeof sp.to === "string" ? sp.to : ""} className="mt-1" />
          </label>
          <label className="text-xs font-medium text-stone-600">
            Link
            <Select name="link" defaultValue={f.linkId ?? ""} className="mt-1">
              <option value="">All links</option>
              {links.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Document
            <Select name="document" defaultValue={f.documentId ?? ""} className="mt-1">
              <option value="">All documents</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-xs font-medium text-stone-600">
            Visitor
            <Input name="visitor" placeholder="email contains…" defaultValue={f.visitor ?? ""} className="mt-1" />
          </label>
          <div className="flex gap-2">
            <Button type="submit" className="flex-1">Apply</Button>
            <Link href="/analytics" className="self-center text-sm text-stone-500 hover:underline">
              Reset
            </Link>
          </div>
        </form>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Visits" value={data.totals.visits} />
        <StatCard label="Identified visitors" value={data.totals.visitors} />
        <StatCard label="Time spent" value={formatDuration(data.totals.seconds)} />
        <StatCard label="Downloads" value={data.totals.downloads} />
      </div>

      <Card className="mb-6">
        <CardHeader title="By document" />
        {data.perDocument.length === 0 ? (
          <EmptyState title="No document views for these filters" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Document</Th>
                <Th className="text-right">Visits</Th>
                <Th className="text-right">Time spent</Th>
                <Th className="text-right">Avg per visit</Th>
              </tr>
            </thead>
            <tbody>
              {data.perDocument.map((d) => (
                <tr key={d.documentId}>
                  <Td>
                    <Link href={`/documents/${d.documentId}`} className="hover:underline">
                      {d.name}
                    </Link>
                  </Td>
                  <Td className="text-right tabular-nums">{d.visits}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(d.seconds ?? 0)}</Td>
                  <Td className="text-right tabular-nums">{formatDuration((d.seconds ?? 0) / Math.max(1, d.visits))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Visits" description={data.truncated ? "Showing the latest 500. Narrow the filters or export for everything." : undefined} />
        {data.visits.length === 0 ? (
          <EmptyState title="No visits for these filters" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Visitor</Th>
                <Th>Link</Th>
                <Th>Started</Th>
                <Th className="text-right">Docs</Th>
                <Th className="text-right">Time</Th>
                <Th className="text-right">Downloads</Th>
                <Th>Device</Th>
                <Th>Country</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {data.visits.map((v) => (
                <tr key={v.visit.id}>
                  <Td>
                    {v.visitorId ? (
                      <Link href={`/visitors/${v.visitorId}`} className="hover:underline">
                        {v.visitorEmail}
                      </Link>
                    ) : (
                      <span className="text-stone-500">Anonymous</span>
                    )}
                  </Td>
                  <Td>{v.linkName}</Td>
                  <Td className="text-stone-500">{formatDateTime(v.visit.startedAt)}</Td>
                  <Td className="text-right tabular-nums">{v.documents}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(v.seconds)}</Td>
                  <Td className="text-right tabular-nums">{v.downloads}</Td>
                  <Td className="text-stone-500">{v.visit.device}</Td>
                  <Td className="text-stone-500">{v.visit.country ?? "—"}</Td>
                  <Td className="font-mono text-xs text-stone-500">{v.visit.ip ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
