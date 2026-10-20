import Link from "next/link";
import { desc, ilike, or, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatDuration, timeAgo } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { VisitorStatusControls, visitorStatusBadge } from "./status-controls";

export const metadata = { title: "Visitors" };

export default async function VisitorsPage({ searchParams }: PageProps<"/visitors">) {
  const user = await requireUser("analytics.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const db = await getDb();
  const canManage = can(user.role, "visitors.manage");

  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = await db
    .select({
      visitor: schema.visitors,
      visits: sql<number>`(select count(*) from ${schema.visits} v where v.visitor_id = "visitors"."id")`.mapWith(Number),
      docs: sql<number>`(select count(distinct dv.document_id) from ${schema.viewEvents} ve join ${schema.visits} v on v.id = ve.visit_id join ${schema.documentVersions} dv on dv.id = ve.document_version_id where v.visitor_id = "visitors"."id")`.mapWith(Number),
      seconds: sql<number>`coalesce((select sum(ve.seconds_viewed) from ${schema.viewEvents} ve join ${schema.visits} v on v.id = ve.visit_id where v.visitor_id = "visitors"."id"), 0)`.mapWith(Number),
      nda: sql<boolean>`exists (select 1 from ${schema.signatures} s where s.visitor_id = "visitors"."id")`,
    })
    .from(schema.visitors)
    .where(q ? or(ilike(schema.visitors.email, like), ilike(schema.visitors.name, like), ilike(schema.visitors.company, like)) : undefined)
    .orderBy(desc(sql`coalesce(${schema.visitors.lastSeenAt}, ${schema.visitors.createdAt})`))
    .limit(500);

  return (
    <>
      <PageHeader title="Visitors" description="Everyone who has entered an email on one of your links." />
      <Card className="mb-4 p-3">
        <form className="flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search name, email or company" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={q ? "No visitors match" : "No visitors yet"} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Company</Th>
                <Th className="text-right">Visits</Th>
                <Th className="text-right">Docs opened</Th>
                <Th className="text-right">Time</Th>
                <Th>Last seen</Th>
                <Th>NDA</Th>
                <Th>Status</Th>
                {canManage && <Th className="sr-only">Actions</Th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ visitor: v, visits, docs, seconds, nda }) => (
                <tr key={v.id} className="hover:bg-stone-50">
                  <Td>
                    <Link href={`/visitors/${v.id}`} className="font-medium hover:underline">
                      {v.name ?? v.email}
                    </Link>
                    {v.name && <p className="text-xs text-stone-500">{v.email}</p>}
                  </Td>
                  <Td className="text-stone-600">{v.company ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{visits}</Td>
                  <Td className="text-right tabular-nums">{docs}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(seconds)}</Td>
                  <Td className="text-stone-500">{timeAgo(v.lastSeenAt)}</Td>
                  <Td>{nda ? <Badge tone="green">Signed</Badge> : <span className="text-stone-400">—</span>}</Td>
                  <Td>{visitorStatusBadge(v.status)}</Td>
                  {canManage && (
                    <Td>
                      <VisitorStatusControls visitor={v} />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
