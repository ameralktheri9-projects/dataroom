import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { formatDateTime, formatDuration } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Input, PageHeader, StatCard, Table, Td } from "@/components/ui";
import { editVisitor } from "../actions";
import { VisitorStatusControls, visitorStatusBadge } from "../status-controls";

export const metadata = { title: "Visitor" };

export default async function VisitorPage({ params }: PageProps<"/visitors/[id]">) {
  const user = await requireUser("analytics.view");
  const { id } = await params;
  const db = await getDb();
  const [visitor] = await db.select().from(schema.visitors).where(eq(schema.visitors.id, id)).limit(1);
  if (!visitor) notFound();
  const canManage = can(user.role, "visitors.manage");

  const [visits, views, signatures, answers, requests, events] = await Promise.all([
    db
      .select({ visit: schema.visits, linkName: schema.links.name, linkId: schema.links.id })
      .from(schema.visits)
      .innerJoin(schema.links, eq(schema.links.id, schema.visits.linkId))
      .where(eq(schema.visits.visitorId, id))
      .orderBy(desc(schema.visits.startedAt)),
    db
      .select({
        visitId: schema.viewEvents.visitId,
        documentId: schema.documents.id,
        name: schema.documents.name,
        version: schema.documentVersions.versionNumber,
        pages: sql<number>`count(distinct ${schema.viewEvents.pageNumber})`.mapWith(Number),
        seconds: sql<number>`sum(${schema.viewEvents.secondsViewed})`.mapWith(Number),
      })
      .from(schema.viewEvents)
      .innerJoin(schema.visits, eq(schema.visits.id, schema.viewEvents.visitId))
      .innerJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.viewEvents.documentVersionId))
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentVersions.documentId))
      .where(eq(schema.visits.visitorId, id))
      .groupBy(schema.viewEvents.visitId, schema.documents.id, schema.documents.name, schema.documentVersions.versionNumber),
    db
      .select({ signature: schema.signatures, agreement: schema.agreements })
      .from(schema.signatures)
      .innerJoin(schema.agreements, eq(schema.agreements.id, schema.signatures.agreementId))
      .where(eq(schema.signatures.visitorId, id))
      .orderBy(desc(schema.signatures.signedAt)),
    db
      .select({ answers: schema.questionnaireAnswers, linkName: schema.links.name })
      .from(schema.questionnaireAnswers)
      .innerJoin(schema.links, eq(schema.links.id, schema.questionnaireAnswers.linkId))
      .where(eq(schema.questionnaireAnswers.visitorId, id)),
    db
      .select({ request: schema.accessRequests, linkName: schema.links.name, documentName: schema.documents.name })
      .from(schema.accessRequests)
      .innerJoin(schema.links, eq(schema.links.id, schema.accessRequests.linkId))
      .leftJoin(schema.documents, eq(schema.documents.id, schema.accessRequests.documentId))
      .where(eq(schema.accessRequests.visitorId, id))
      .orderBy(desc(schema.accessRequests.createdAt)),
    db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.actorType, "visitor"), eq(schema.auditLog.actorId, id)))
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(100),
  ]);

  const totalSeconds = views.reduce((a, v) => a + v.seconds, 0);
  const docsOpened = new Set(views.map((v) => v.documentId)).size;

  return (
    <>
      <PageHeader
        title={visitor.name ?? visitor.email}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {visitor.email}
            {visitor.company ? ` · ${visitor.company}` : ""} {visitorStatusBadge(visitor.status)}
          </span>
        }
        actions={canManage ? <VisitorStatusControls visitor={visitor} /> : null}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Visits" value={visits.length} />
        <StatCard label="Documents opened" value={docsOpened} />
        <StatCard label="Time spent" value={formatDuration(totalSeconds)} />
        <StatCard label="First seen" value={<span className="text-base">{formatDateTime(visitor.createdAt)}</span>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Activity" />
            {visits.length === 0 ? (
              <EmptyState title="No visits yet" />
            ) : (
              <ul className="divide-y divide-stone-100">
                {visits.map(({ visit, linkName, linkId }) => {
                  const docs = views.filter((v) => v.visitId === visit.id);
                  return (
                    <li key={visit.id} className="px-5 py-3">
                      <p className="text-sm">
                        Opened <Link href={`/links/${linkId}`} className="font-medium hover:underline">{linkName}</Link>
                        <span className="text-stone-500">
                          {" "}
                          · {formatDateTime(visit.startedAt)} · {visit.device} · {visit.country ?? "unknown country"} · {visit.ip ?? "no IP"}
                        </span>
                      </p>
                      {docs.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 ps-4 text-xs text-stone-600">
                          {docs.map((d) => (
                            <li key={d.documentId + d.version}>
                              <Link href={`/documents/${d.documentId}`} className="hover:underline">
                                {d.name}
                              </Link>{" "}
                              v{d.version} — {d.pages} page{d.pages === 1 ? "" : "s"}, {formatDuration(d.seconds)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Audit trail" description="Everything this visitor did, newest first." />
            {events.length === 0 ? (
              <EmptyState title="No events" />
            ) : (
              <Table>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <Td className="w-44 text-xs text-stone-500">{formatDateTime(e.createdAt)}</Td>
                      <Td className="font-mono text-xs">{e.action}</Td>
                      <Td className="font-mono text-xs text-stone-500">{e.ip ?? ""}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {canManage && (
            <Card className="p-4">
              <ActionForm action={editVisitor} className="space-y-3">
                <input type="hidden" name="id" value={visitor.id} />
                <Field label="Name" htmlFor="v-name">
                  <Input id="v-name" name="name" defaultValue={visitor.name ?? ""} />
                </Field>
                <Field label="Company" htmlFor="v-company">
                  <Input id="v-company" name="company" defaultValue={visitor.company ?? ""} />
                </Field>
                <SubmitButton variant="secondary" className="w-full">
                  Save
                </SubmitButton>
              </ActionForm>
            </Card>
          )}

          <Card>
            <CardHeader title="Agreements" />
            {signatures.length === 0 ? (
              <p className="px-5 py-4 text-sm text-stone-500">No agreements signed.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {signatures.map(({ signature: s, agreement: a }) => (
                  <li key={s.id} className="px-5 py-3 text-sm">
                    <p className="font-medium">
                      {a.name} <Badge>v{a.version}</Badge>
                    </p>
                    <p className="text-xs text-stone-500">
                      {s.fullName} · {formatDateTime(s.signedAt)} · {s.ip ?? "no IP"}
                    </p>
                    {s.signedPdfKey && (
                      <a href={`/api/admin/signatures/${s.id}`} className="text-xs text-accent hover:underline">
                        Signed copy (PDF)
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {answers.length > 0 && (
            <Card>
              <CardHeader title="Questionnaire answers" />
              <ul className="divide-y divide-stone-100">
                {answers.map(({ answers: a, linkName }) => (
                  <li key={a.id} className="px-5 py-3 text-sm">
                    <p className="mb-1 text-xs text-stone-500">{linkName}</p>
                    <dl className="space-y-1">
                      {Object.entries(a.answers).map(([q, ans]) => (
                        <div key={q}>
                          <dt className="text-xs font-medium text-stone-600">{q}</dt>
                          <dd>{ans || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Requests" />
            {requests.length === 0 ? (
              <p className="px-5 py-4 text-sm text-stone-500">None.</p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {requests.map(({ request: r, linkName, documentName }) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-5 py-3 text-sm">
                    <span className="min-w-0 truncate">
                      {r.type === "access" ? `Access · ${linkName}` : `Download · ${documentName}`}
                    </span>
                    <Badge tone={r.status === "approved" ? "green" : r.status === "rejected" ? "red" : "amber"}>{r.status}</Badge>
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
