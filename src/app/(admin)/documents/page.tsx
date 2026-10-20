import Link from "next/link";
import { asc, count, eq, isNull } from "drizzle-orm";
import { ChevronRight, FileText, Folder as FolderIcon } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { can } from "@/lib/permissions";
import { folderBreadcrumb } from "@/lib/documents";
import { fileKind, formatBytes, formatDate } from "@/lib/utils";
import { ActionForm, ConfirmSubmit, SubmitButton } from "@/components/action-form";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { Uploader } from "@/components/uploader";
import { createFolder, deleteFolder } from "./actions";

export const metadata = { title: "Documents" };

const KIND_LABEL = { pdf: "PDF", image: "Image", video: "Video", office: "Office", other: "File" } as const;

export default async function DocumentsPage({ searchParams }: PageProps<"/documents">) {
  const user = await requireUser();
  const sp = await searchParams;
  const folderId = typeof sp.folder === "string" ? sp.folder : null;
  const editable = can(user.role, "documents.edit");
  const db = await getDb();

  const trail = await folderBreadcrumb(folderId);
  const current = trail.at(-1) ?? null;

  const folders = await db
    .select()
    .from(schema.folders)
    .where(folderId ? eq(schema.folders.parentId, folderId) : isNull(schema.folders.parentId))
    .orderBy(asc(schema.folders.name));

  const docs = await db
    .select({ document: schema.documents, version: schema.documentVersions })
    .from(schema.documents)
    .leftJoin(schema.documentVersions, eq(schema.documentVersions.id, schema.documents.currentVersionId))
    .where(folderId ? eq(schema.documents.folderId, folderId) : isNull(schema.documents.folderId))
    .orderBy(asc(schema.documents.name));

  const versionCounts = new Map(
    (
      await db
        .select({ documentId: schema.documentVersions.documentId, n: count() })
        .from(schema.documentVersions)
        .groupBy(schema.documentVersions.documentId)
    ).map((r) => [r.documentId, r.n]),
  );

  return (
    <>
      <PageHeader
        title={current?.name ?? "Documents"}
        description={
          <span className="flex flex-wrap items-center gap-1">
            <Link href="/documents" className="hover:underline">
              All documents
            </Link>
            {trail.map((f) => (
              <span key={f.id} className="flex items-center gap-1">
                <ChevronRight className="size-3" aria-hidden />
                <Link href={`/documents?folder=${f.id}`} className="hover:underline">
                  {f.name}
                </Link>
              </span>
            ))}
          </span>
        }
        actions={
          editable && current ? (
            <>
              <LinkButton variant="secondary" href={`/links/new?folder=${current.id}`}>
                Share folder
              </LinkButton>
              <form action={deleteFolder}>
                <input type="hidden" name="id" value={current.id} />
                <ConfirmSubmit message={`Delete "${current.name}" and everything inside it? Links to it will stop working.`}>Delete folder</ConfirmSubmit>
              </form>
            </>
          ) : null
        }
      />

      {editable && (
        <div className="mb-6 grid gap-4 md:grid-cols-[1fr_280px]">
          <Uploader folderId={folderId} />
          <Card className="p-4">
            <ActionForm action={createFolder} resetOnSuccess className="space-y-2">
              <input type="hidden" name="parentId" value={folderId ?? ""} />
              <label htmlFor="folder-name" className="text-sm font-medium">
                New folder
              </label>
              <Input id="folder-name" name="name" placeholder="e.g. Financials" required />
              <SubmitButton variant="secondary" className="w-full">
                Create folder
              </SubmitButton>
            </ActionForm>
          </Card>
        </div>
      )}

      <Card>
        {folders.length === 0 && docs.length === 0 ? (
          <EmptyState title="This folder is empty">{editable ? "Upload files or create a folder to get started." : null}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th className="text-right">Size</Th>
                <Th>Version</Th>
                <Th>Updated</Th>
                <Th className="sr-only">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {folders.map((f) => (
                <tr key={f.id} className="hover:bg-stone-50">
                  <Td>
                    <Link href={`/documents?folder=${f.id}`} className="flex items-center gap-2 font-medium">
                      <FolderIcon className="size-4 text-amber-500" aria-hidden />
                      {f.name}
                    </Link>
                  </Td>
                  <Td className="text-stone-500">Folder</Td>
                  <Td />
                  <Td />
                  <Td className="text-stone-500">{formatDate(f.updatedAt)}</Td>
                  <Td className="text-right">
                    {editable && (
                      <Link href={`/links/new?folder=${f.id}`} className="text-sm text-accent hover:underline">
                        Share
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
              {docs.map(({ document: d, version: v }) => (
                <tr key={d.id} className="hover:bg-stone-50">
                  <Td>
                    <Link href={`/documents/${d.id}`} className="flex items-center gap-2 font-medium">
                      <FileText className="size-4 text-stone-400" aria-hidden />
                      {d.name}
                    </Link>
                  </Td>
                  <Td className="text-stone-500">{v ? KIND_LABEL[fileKind(v.fileType, v.fileName)] : "—"}</Td>
                  <Td className="text-right text-stone-500 tabular-nums">{v ? formatBytes(v.size) : "—"}</Td>
                  <Td>
                    <Badge>v{v?.versionNumber ?? 0}</Badge>
                    {(versionCounts.get(d.id) ?? 0) > 1 && (
                      <span className="ml-1 text-xs text-stone-500">of {versionCounts.get(d.id)}</span>
                    )}
                  </Td>
                  <Td className="text-stone-500">{formatDate(v?.createdAt ?? d.updatedAt)}</Td>
                  <Td className="text-right">
                    {editable && (
                      <Link href={`/links/new?document=${d.id}`} className="text-sm text-accent hover:underline">
                        Share
                      </Link>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
