import Link from "next/link";
import { and, count, countDistinct, desc, eq, gte, isNull, sum } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { daysAgo, formatDateTime, formatDuration, timeAgo } from "@/lib/utils";
import { SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { decideRequest } from "./actions";

export const metadata = { title: "Home" };

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const since = daysAgo(30);

  const [[activeLinks], [visits30], [time30], [docs]] = await Promise.all([
    db.select({ n: count() }).from(schema.links).where(and(eq(schema.links.status, "active"), isNull(schema.links.deletedAt))),
    db
      .select({ n: count(), visitors: countDistinct(schema.visits.visitorId) })
      .from(schema.visits)
      .where(gte(schema.visits.startedAt, since)),
    db
      .select({ s: sum(schema.viewEvents.secondsViewed).mapWith(Number) })
      .from(schema.viewEvents)
      .where(gte(schema.viewEvents.createdAt, since)),
    db.select({ n: count() }).from(schema.documents),
  ]);

  const requests = await db
    .select({ request: schema.accessRequests, visitor: schema.visitors, link: schema.links, document: schema.documents })
    .from(schema.accessRequests)
    .innerJoin(schema.visitors, eq(schema.visitors.id, schema.accessRequests.visitorId))
    .innerJoin(schema.links, eq(schema.links.id, schema.accessRequests.linkId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.accessRequests.documentId))
    .where(eq(schema.accessRequests.status, "pending"))
    .orderBy(desc(schema.accessRequests.createdAt));

  const recent = await db
    .select({ visit: schema.visits, visitor: schema.visitors, link: schema.links })
    .from(schema.visits)
    .innerJoin(schema.links, eq(schema.links.id, schema.visits.linkId))
    .leftJoin(schema.visitors, eq(schema.visitors.id, schema.visits.visitorId))
    .orderBy(desc(schema.visits.startedAt))
    .limit(10);

  const canDecide = can(user.role, "requests.decide");

  return (
    <>
      <PageHeader
        title={`Welcome, ${user.name.split(" ")[0]}`}
        actions={can(user.role, "links.create") ? <LinkButton href="/links/new">New link</LinkButton> : null}
      />
      {sp.denied && (
        <div className="mb-4">
          <Alert tone="amber">Your role does not have access to that page.</Alert>
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active links" value={activeLinks.n} />
        <StatCard label="Visits (30 days)" value={visits30.n} sub={`${visits30.visitors} identified visitors`} />
        <StatCard label="Time spent (30 days)" value={formatDuration(time30.s ?? 0)} />
        <StatCard label="Documents" value={docs.n} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              Requests {requests.length > 0 && <Badge tone="amber">{requests.length} pending</Badge>}
            </span>
          }
          description="Access requests (manual approval) and download requests."
        />
        {requests.length === 0 ? (
          <EmptyState title="No pending requests" />
        ) : (
          <ul className="divide-y divide-stone-100">
            {requests.map(({ request, visitor, link, document }) => (
              <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 text-sm">
                  <p>
                    <Link href={`/visitors/${visitor.id}`} className="font-medium hover:underline">
                      {visitor.name ? `${visitor.name} (${visitor.email})` : visitor.email}
                    </Link>{" "}
                    {request.type === "access" ? (
                      <>
                        wants access to <Link href={`/links/${link.id}`} className="hover:underline">{link.name}</Link>
                      </>
                    ) : (
                      <>
                        wants to download <span className="font-medium">{document?.name}</span> from{" "}
                        <Link href={`/links/${link.id}`} className="hover:underline">{link.name}</Link>
                      </>
                    )}
                  </p>
                  <p className="text-xs text-stone-500">
                    {visitor.company ? `${visitor.company} · ` : ""}
                    {timeAgo(request.createdAt)}
                  </p>
                </div>
                {canDecide ? (
                  <div className="flex gap-2">
                    <form action={decideRequest}>
                      <input type="hidden" name="id" value={request.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <SubmitButton variant="secondary">Reject</SubmitButton>
                    </form>
                    <form action={decideRequest}>
                      <input type="hidden" name="id" value={request.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <SubmitButton>Approve</SubmitButton>
                    </form>
                  </div>
                ) : (
                  <span className="text-xs text-stone-500">An Owner or Admin can decide</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="Recent visits" action={<Link href="/analytics" className="text-sm text-accent hover:underline">All analytics</Link>} />
        {recent.length === 0 ? (
          <EmptyState title="No visits yet">Create a link and send it to see activity here.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Visitor</Th>
                <Th>Link</Th>
                <Th>When</Th>
                <Th>Device</Th>
                <Th>Country</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ visit, visitor, link }) => (
                <tr key={visit.id}>
                  <Td>
                    {visitor ? (
                      <Link href={`/visitors/${visitor.id}`} className="hover:underline">
                        {visitor.email}
                      </Link>
                    ) : (
                      <span className="text-stone-500">Anonymous</span>
                    )}
                  </Td>
                  <Td>
                    <Link href={`/links/${link.id}`} className="hover:underline">
                      {link.name}
                    </Link>
                  </Td>
                  <Td className="text-stone-500">{formatDateTime(visit.startedAt)}</Td>
                  <Td className="text-stone-500">{visit.device}</Td>
                  <Td className="text-stone-500">{visit.country ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
