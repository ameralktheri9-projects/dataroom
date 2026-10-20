import Link from "next/link";
import { notFound } from "next/navigation";
import { and, countDistinct, desc, eq, inArray, max, sql, sum } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { folderBreadcrumb } from "@/lib/documents";
import { fileKind, formatBytes, formatDateTime, formatDuration } from "@/lib/utils";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Input, LinkButton, PageHeader, StatCard, Table, Td, Th } from "@/components/ui";
import { Uploader } from "@/components/uploader";
import { Viewer } from "@/components/viewer";
import { deleteDocument, renameDocument } from "../actions";

export const metadata = { title: "Document" };

export default async function DocumentPage({ params }: PageProps<"/documents/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const db = await getDb();
  const editable = can(user.role, "documents.edit");

  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id)).limit(1);
  if (!doc) notFound();

  const versions = await db
    .select()
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id))
    .orderBy(desc(schema.documentVersions.versionNumber));
  const current = versions.find((v) => v.id === doc.currentVersionId) ?? versions[0];
  const versionIds = versions.map((v) => v.id);
  const trail = await folderBreadcrumb(doc.folderId);

  const [totals] = versionIds.length
    ? await db
        .select({
          visits: countDistinct(schema.viewEvents.visitId),
          seconds: sum(schema.viewEvents.secondsViewed).mapWith(Number),
        })
        .from(schema.viewEvents)
        .where(inArray(schema.viewEvents.documentVersionId, versionIds))
    : [{ visits: 0, seconds: 0 }];

  const viewers = versionIds.length
    ? await db
        .select({
          visitorId: schema.visitors.id,
          email: schema.visitors.email,
          seconds: sum(schema.viewEvents.secondsViewed).mapWith(Number),
          pages: countDistinct(schema.viewEvents.pageNumber),
          last: max(schema.viewEvents.updatedAt),
        })
        .from(schema.viewEvents)
        .innerJoin(schema.visits, eq(schema.visits.id, schema.viewEvents.visitId))
        .innerJoin(schema.visitors, eq(schema.visitors.id, schema.visits.visitorId))
        .where(inArray(schema.viewEvents.documentVersionId, versionIds))
        .groupBy(schema.visitors.id, schema.visitors.email)
        .orderBy(desc(max(schema.viewEvents.updatedAt)))
        .limit(25)
    : [];

  const pageTimes = current
    ? await db
        .select({
          page: schema.viewEvents.pageNumber,
          seconds: sum(schema.viewEvents.secondsViewed).mapWith(Number),
          visits: countDistinct(schema.viewEvents.visitId),
        })
        .from(schema.viewEvents)
        .where(eq(schema.viewEvents.documentVersionId, current.id))
        .groupBy(schema.viewEvents.pageNumber)
        .orderBy(schema.viewEvents.pageNumber)
    : [];
  const maxPageSeconds = Math.max(1, ...pageTimes.map((p) => p.seconds / Math.max(1, p.visits)));

  const [{ downloads }] = versionIds.length
    ? await db
        .select({ downloads: sql<number>`count(*)`.mapWith(Number) })
        .from(schema.downloads)
        .where(inArray(schema.downloads.documentVersionId, versionIds))
    : [{ downloads: 0 }];

  const links = await db
    .select({ id: schema.links.id, name: schema.links.name, status: schema.links.status })
    .from(schema.linkScope)
    .innerJoin(schema.links, eq(schema.links.id, schema.linkScope.linkId))
    .where(and(eq(schema.linkScope.documentId, id), sql`${schema.links.deletedAt} is null`));

  return (
    <>
      <PageHeader
        title={doc.name}
        description={
          <span>
            <Link href="/documents" className="hover:underline">
              All documents
            </Link>
            {trail.map((f) => (
              <span key={f.id}>
                {" / "}
                <Link href={`/documents?folder=${f.id}`} className="hover:underline">
                  {f.name}
                </Link>
              </span>
            ))}
          </span>
        }
        actions={
          editable ? (
            <>
              <LinkButton href={`/links/new?document=${doc.id}`}>Share</LinkButton>
              <form action={deleteDocument}>
                <input type="hidden" name="id" value={doc.id} />
                <ConfirmSubmit message={`Delete "${doc.name}" and all its versions? Links will no longer show it.`}>Delete</ConfirmSubmit>
              </form>
            </>
          ) : null
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Visits" value={totals.visits} />
        <StatCard label="Time spent" value={formatDuration(totals.seconds ?? 0)} />
        <StatCard label="Downloads" value={downloads} />
        <StatCard label="Version" value={`v${current?.versionNumber ?? 0}`} sub={current ? formatBytes(current.size) : undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <div className="rounded-lg bg-stone-100 p-3 md:p-6">
            {current ? (
              <Viewer
                kind={fileKind(current.fileType, current.fileName)}
                fileUrl={`/api/admin/versions/${current.id}`}
                versionId={current.id}
                watermark={null}
                trackUrl={null}
              />
            ) : (
              <EmptyState title="No file uploaded" />
            )}
          </div>

          <Card>
            <CardHeader title="Time per page" description="Average seconds per visit on the current version" />
            {pageTimes.length === 0 ? (
              <EmptyState title="No views yet" />
            ) : (
              <div className="space-y-1.5 px-5 py-4">
                {pageTimes.map((p) => {
                  const avg = p.seconds / Math.max(1, p.visits);
                  return (
                    <div key={p.page} className="flex items-center gap-3 text-xs">
                      <span className="w-12 shrink-0 text-stone-500 tabular-nums">Page {p.page}</span>
                      <div className="h-3 flex-1 rounded bg-stone-100">
                        <div className="h-3 rounded bg-accent" style={{ width: `${(avg / maxPageSeconds) * 100}%` }} />
                      </div>
                      <span className="w-14 shrink-0 text-right tabular-nums">{formatDuration(avg)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Who viewed it" />
            {viewers.length === 0 ? (
              <EmptyState title="No identified viewers yet" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Visitor</Th>
                    <Th className="text-right">Pages</Th>
                    <Th className="text-right">Time</Th>
                    <Th>Last viewed</Th>
                  </tr>
                </thead>
                <tbody>
                  {viewers.map((v) => (
                    <tr key={v.visitorId}>
                      <Td>
                        <Link href={`/visitors/${v.visitorId}`} className="hover:underline">
                          {v.email}
                        </Link>
                      </Td>
                      <Td className="text-right tabular-nums">{v.pages}</Td>
                      <Td className="text-right tabular-nums">{formatDuration(v.seconds ?? 0)}</Td>
                      <Td className="text-stone-500">{formatDateTime(v.last)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {editable && (
            <Card className="p-4">
              <ActionForm action={renameDocument} className="space-y-2">
                <input type="hidden" name="id" value={doc.id} />
                <label htmlFor="doc-name" className="text-sm font-medium">
                  Name
                </label>
                <Input id="doc-name" name="name" defaultValue={doc.name} required />
                <SubmitButton variant="secondary" className="w-full">
                  Rename
                </SubmitButton>
              </ActionForm>
            </Card>
          )}

          {editable && <Uploader folderId={doc.folderId} documentId={doc.id} compact />}

          <Card>
            <CardHeader title="Versions" description="Links always show the latest version." />
            <ul className="divide-y divide-stone-100">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <span className="font-medium">v{v.versionNumber}</span>
                      {v.id === doc.currentVersionId && <Badge tone="green">Current</Badge>}
                    </p>
                    <p className="truncate text-xs text-stone-500">
                      {v.fileName} · {formatBytes(v.size)} · {formatDateTime(v.createdAt)}
                    </p>
                  </div>
                  <a href={`/api/admin/versions/${v.id}?download`} className="shrink-0 text-xs text-accent hover:underline">
                    Download
                  </a>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Shared directly in" />
            {links.length === 0 ? (
              <p className="px-5 py-4 text-sm text-stone-500">Not shared on its own. It may still be inside a shared folder.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <Link href={`/links/${l.id}`} className="hover:underline">
                      {l.name}
                    </Link>
                    <Badge tone={l.status === "active" ? "green" : "neutral"}>{l.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
