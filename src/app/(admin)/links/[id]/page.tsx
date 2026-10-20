import Link from "next/link";
import { notFound } from "next/navigation";
import { and, count, countDistinct, desc, eq, isNull, sum } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { can } from "@/lib/permissions";
import { linkSettingsSchema } from "@/lib/access/settings";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Alert, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";
import { LinkForm } from "../link-form";
import { formData } from "../data";
import { deleteLink, setLinkStatus } from "../actions";
import { linkStatusBadge } from "../status";

export const metadata = { title: "Link" };

export default async function LinkPage({ params, searchParams }: PageProps<"/links/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();

  const [link] = await db
    .select()
    .from(schema.links)
    .where(and(eq(schema.links.id, id), isNull(schema.links.deletedAt)))
    .limit(1);
  if (!link) notFound();
  const settings = linkSettingsSchema.parse(link.settings);
  const editable = can(user.role, "links.settings");
  const url = `${env().APP_URL}/v/${link.slug}`;

  const scope = await db.select().from(schema.linkScope).where(eq(schema.linkScope.linkId, id));
  const allow = await db.select().from(schema.allowedEmails).where(eq(schema.allowedEmails.linkId, id));

  const [stats] = await db
    .select({ visits: count(schema.visits.id), visitors: countDistinct(schema.visits.visitorId) })
    .from(schema.visits)
    .where(eq(schema.visits.linkId, id));
  const [time] = await db
    .select({ seconds: sum(schema.viewEvents.secondsViewed).mapWith(Number) })
    .from(schema.viewEvents)
    .innerJoin(schema.visits, eq(schema.visits.id, schema.viewEvents.visitId))
    .where(eq(schema.visits.linkId, id));

  const recent = await db
    .select({ visit: schema.visits, visitor: schema.visitors })
    .from(schema.visits)
    .leftJoin(schema.visitors, eq(schema.visitors.id, schema.visits.visitorId))
    .where(eq(schema.visits.linkId, id))
    .orderBy(desc(schema.visits.startedAt))
    .limit(20);

  return (
    <>
      <PageHeader
        title={link.name}
        description={<span className="flex items-center gap-2">{linkStatusBadge(link)}</span>}
        actions={
          editable ? (
            <>
              <form action={setLinkStatus}>
                <input type="hidden" name="id" value={link.id} />
                <input type="hidden" name="status" value={link.status === "active" ? "disabled" : "active"} />
                <SubmitButton variant="secondary">{link.status === "active" ? "Disable" : "Enable"}</SubmitButton>
              </form>
              <form action={deleteLink}>
                <input type="hidden" name="id" value={link.id} />
                <ConfirmSubmit message="Delete this link? Anyone using it loses access immediately. Analytics are kept.">Delete</ConfirmSubmit>
              </form>
            </>
          ) : null
        }
      />

      {sp.created && (
        <div className="mb-4">
          <Alert tone="green">Link created. Copy it below and send it to your investor.</Alert>
        </div>
      )}

      <Card className="mb-6 flex flex-wrap items-center gap-3 px-5 py-4">
        <code className="min-w-0 flex-1 truncate rounded bg-stone-100 px-3 py-2 font-mono text-sm">{url}</code>
        <CopyButton value={url} label="Copy link" />
        <a href={url} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
          Open as visitor
        </a>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard label="Visits" value={stats.visits} />
        <StatCard label="Identified visitors" value={stats.visitors} />
        <StatCard label="Time spent" value={formatDuration(time?.seconds ?? 0)} />
      </div>

      <Card className="mb-6">
        <CardHeader title="Recent visits" />
        {recent.length === 0 ? (
          <EmptyState title="No visits yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Visitor</Th>
                <Th>When</Th>
                <Th>Device</Th>
                <Th>Country</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map(({ visit, visitor }) => (
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
                  <Td className="text-stone-500">{formatDateTime(visit.startedAt)}</Td>
                  <Td className="text-stone-500">{visit.device}</Td>
                  <Td className="text-stone-500">{visit.country ?? "—"}</Td>
                  <Td className="font-mono text-xs text-stone-500">{visit.ip ?? "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {editable && (
        <>
          <h2 className="mb-3 text-base font-semibold">Settings</h2>
          <LinkForm
            {...await formData()}
            initial={{
              id: link.id,
              name: link.name,
              folderIds: scope.flatMap((s) => (s.folderId ? [s.folderId] : [])),
              documentIds: scope.flatMap((s) => (s.documentId ? [s.documentId] : [])),
              settings,
              allowListEntries: allow.map((a) => a.emailOrDomain),
              hasPassword: !!link.passwordHash,
              agreementId: link.agreementId,
              expiryPreset: link.expiresAt ? "custom" : "never",
              expiryCustom: link.expiresAt?.toISOString() ?? null,
            }}
          />
        </>
      )}
    </>
  );
}
