import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { parseAuditFilters, queryAudit } from "@/lib/audit-query";
import { formatDateTime } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Audit log" };

const PAGE = 100;

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  await requireUser("analytics.view");
  const sp = await searchParams;
  const f = parseAuditFilters(sp);
  const page = Math.max(1, Number(sp.page) || 1);
  const rows = await queryAudit(f, PAGE + 1, (page - 1) * PAGE);
  const hasMore = rows.length > PAGE;
  const params = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v && k !== "page" ? [[k, v]] : [])));
  const pageHref = (p: number) => `/audit?${new URLSearchParams([...params, ["page", String(p)]])}`;

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every action by the team and visitors. Entries cannot be edited or deleted."
        actions={<LinkButton variant="secondary" href={`/api/audit/export?${params}`} prefetch={false}>Export CSV</LinkButton>}
      />
      <Card className="mb-4 p-3">
        <form className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <Input name="q" defaultValue={f.q} placeholder="Search action, email or IP (e.g. link.create, jane@)" />
          <Input type="date" name="from" defaultValue={typeof sp.from === "string" ? sp.from : ""} aria-label="From" />
          <Input type="date" name="to" defaultValue={typeof sp.to === "string" ? sp.to : ""} aria-label="To" />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </Card>
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PAGE).map((e) => (
                <tr key={e.id} className="align-top">
                  <Td className="whitespace-nowrap text-xs text-stone-500">{formatDateTime(e.createdAt)}</Td>
                  <Td className="text-xs">
                    <Badge tone={e.actorType === "user" ? "blue" : e.actorType === "visitor" ? "neutral" : "amber"}>{e.actorType}</Badge>{" "}
                    {e.actorType === "visitor" && e.actorId ? (
                      <Link href={`/visitors/${e.actorId}`} className="hover:underline">
                        {e.actorLabel ?? "anonymous"}
                      </Link>
                    ) : (
                      (e.actorLabel ?? "anonymous")
                    )}
                  </Td>
                  <Td className="font-mono text-xs">{e.action}</Td>
                  <Td className="text-xs text-stone-500">
                    {e.targetType ? `${e.targetType}${e.targetId ? ` ${e.targetId.slice(0, 8)}` : ""}` : "—"}
                  </Td>
                  <Td className="max-w-xs truncate font-mono text-xs text-stone-500" title={e.metadata ? JSON.stringify(e.metadata) : ""}>
                    {e.metadata ? JSON.stringify(e.metadata) : ""}
                  </Td>
                  <Td className="font-mono text-xs text-stone-500">{e.ip ?? ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <div className="mt-4 flex justify-between text-sm">
        {page > 1 ? <Link href={pageHref(page - 1)} className="text-accent hover:underline">← Newer</Link> : <span />}
        {hasMore && <Link href={pageHref(page + 1)} className="text-accent hover:underline">Older →</Link>}
      </div>
    </>
  );
}
