"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { userCan } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { requestDecidedEmail } from "@/lib/email/templates";
import { getBrand } from "@/lib/workspace";
import { str } from "@/lib/form";

/** FR-44: approve or reject an access/download request; the visitor is emailed either way. */
export async function decideRequest(fd: FormData): Promise<void> {
  const user = await userCan("requests.decide");
  if (!user) return;
  const id = str(fd, "id");
  const approved = str(fd, "decision") === "approve";
  const db = await getDb();

  const [updated] = await db
    .update(schema.accessRequests)
    .set({ status: approved ? "approved" : "rejected", decidedBy: user.id, decidedAt: new Date() })
    .where(and(eq(schema.accessRequests.id, id), eq(schema.accessRequests.status, "pending")))
    .returning();
  if (!updated) return; // already decided by someone else

  const [row] = await db
    .select({ visitor: schema.visitors, link: schema.links, document: schema.documents })
    .from(schema.accessRequests)
    .innerJoin(schema.visitors, eq(schema.visitors.id, schema.accessRequests.visitorId))
    .innerJoin(schema.links, eq(schema.links.id, schema.accessRequests.linkId))
    .leftJoin(schema.documents, eq(schema.documents.id, schema.accessRequests.documentId))
    .where(eq(schema.accessRequests.id, id));

  await audit({
    actor: { type: "user", id: user.id, label: user.email },
    action: `request.${updated.type}.${approved ? "approve" : "reject"}`,
    targetType: "visitor",
    targetId: updated.visitorId,
    metadata: { requestId: id, linkId: updated.linkId, documentId: updated.documentId },
  });

  if (row) {
    const url = `${env().APP_URL}/v/${row.link.slug}${row.document ? `/d/${row.document.id}` : ""}`;
    const msg = requestDecidedEmail(await getBrand(), {
      kind: updated.type,
      approved,
      linkName: row.link.name,
      documentName: row.document?.name,
      url,
    });
    await sendEmail({ to: row.visitor.email, ...msg });
  }
  revalidatePath("/");
}
