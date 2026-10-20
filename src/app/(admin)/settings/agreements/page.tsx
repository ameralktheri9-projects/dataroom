import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { formatDateTime } from "@/lib/utils";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Input, Table, Td, Th } from "@/components/ui";
import { uploadAgreement } from "../actions";

export const metadata = { title: "Agreements" };

export default async function AgreementsPage() {
  const db = await getDb();
  const rows = await db
    .select({
      agreement: schema.agreements,
      signatures: sql<number>`(select count(*) from ${schema.signatures} s where s.agreement_id = "agreements"."id")`.mapWith(Number),
      links: sql<number>`(select count(*) from ${schema.links} l where l.agreement_id = "agreements"."id" and l.deleted_at is null)`.mapWith(Number),
      uploader: schema.users.name,
    })
    .from(schema.agreements)
    .leftJoin(schema.users, eq(schema.users.id, schema.agreements.uploadedBy))
    .orderBy(schema.agreements.name, desc(schema.agreements.version));

  return (
    <div className="space-y-6">
      <Card className="max-w-xl p-5">
        <h2 className="text-sm font-semibold">Upload an agreement</h2>
        <p className="mt-1 mb-4 text-xs text-stone-500">
          PDF only. Uploading with an existing name creates a new version; links switch to it and visitors accept it on their next visit.
          The wording should be approved by your legal advisor.
        </p>
        <ActionForm action={uploadAgreement} resetOnSuccess className="space-y-3">
          <Field label="Name" htmlFor="ag-name">
            <Input id="ag-name" name="name" placeholder="Mutual NDA" required list="agreement-names" />
            <datalist id="agreement-names">
              {[...new Set(rows.map((r) => r.agreement.name))].map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <Field label="PDF" htmlFor="ag-file">
            <Input id="ag-file" name="file" type="file" accept="application/pdf" required className="py-1.5" />
          </Field>
          <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
        </ActionForm>
      </Card>

      <Card>
        <CardHeader title="Agreements" />
        {rows.length === 0 ? (
          <EmptyState title="No agreements yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Version</Th>
                <Th className="text-right">Signatures</Th>
                <Th className="text-right">Links</Th>
                <Th>Uploaded</Th>
                <Th className="sr-only">View</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ agreement: a, signatures, links, uploader }) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.name}</Td>
                  <Td>
                    v{a.version} {a.isCurrent ? <Badge tone="green">Current</Badge> : <Badge>Superseded</Badge>}
                  </Td>
                  <Td className="text-right tabular-nums">{signatures}</Td>
                  <Td className="text-right tabular-nums">{links}</Td>
                  <Td className="text-stone-500">
                    {formatDateTime(a.createdAt)} · {uploader ?? "—"}
                  </Td>
                  <Td>
                    <a href={`/api/admin/agreements/${a.id}`} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                      View
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
