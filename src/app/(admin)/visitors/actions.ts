"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { userCan } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { str, type FormState } from "@/lib/form";

const STATUSES = ["active", "suspended", "revoked"] as const;

/** FR-54: takes effect on the visitor's next request, on every link. */
export async function setVisitorStatus(fd: FormData): Promise<void> {
  const user = await userCan("visitors.manage");
  if (!user) return;
  const id = str(fd, "id");
  const status = STATUSES.find((s) => s === str(fd, "status"));
  if (!status) return;
  const db = await getDb();
  const [v] = await db.update(schema.visitors).set({ status }).where(eq(schema.visitors.id, id)).returning();
  if (!v) return;
  const action = status === "active" ? "visitor.reactivate" : status === "suspended" ? "visitor.suspend" : "visitor.revoke";
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action, targetType: "visitor", targetId: id, metadata: { email: v.email } });
  revalidatePath("/visitors");
  revalidatePath(`/visitors/${id}`);
}

export async function editVisitor(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("visitors.manage");
  if (!user) return { error: "You don't have permission to edit visitors." };
  const id = str(fd, "id");
  const name = str(fd, "name").slice(0, 200) || null;
  const company = str(fd, "company").slice(0, 200) || null;
  const db = await getDb();
  await db.update(schema.visitors).set({ name, company }).where(eq(schema.visitors.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "visitor.edit", targetType: "visitor", targetId: id, metadata: { name, company } });
  revalidatePath(`/visitors/${id}`);
  return { success: "Saved." };
}
