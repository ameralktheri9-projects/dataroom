import { requireUser } from "@/lib/auth/session";
import { defaultLinkSettings } from "@/lib/access/settings";
import { PageHeader } from "@/components/ui";
import { LinkForm } from "../link-form";
import { formData } from "../data";

export const metadata = { title: "New link" };

export default async function NewLinkPage({ searchParams }: PageProps<"/links/new">) {
  await requireUser("links.create");
  const sp = await searchParams;
  const data = await formData();

  const folder = typeof sp.folder === "string" ? data.folders.find((f) => f.id === sp.folder) : undefined;
  const doc = typeof sp.document === "string" ? data.documents.find((d) => d.id === sp.document) : undefined;

  return (
    <>
      <PageHeader title="New link" description="Share chosen files and folders with protection and tracking." />
      <LinkForm
        {...data}
        initial={{
          id: null,
          name: folder?.name ?? doc?.name ?? "",
          folderIds: folder ? [folder.id] : [],
          documentIds: doc ? [doc.id] : [],
          settings: { ...defaultLinkSettings, watermark: true },
          allowListEntries: [],
          hasPassword: false,
          agreementId: null,
          expiryPreset: "never",
          expiryCustom: null,
        }}
      />
    </>
  );
}
