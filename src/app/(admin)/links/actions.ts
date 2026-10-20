"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { z } from "zod";
import { userCan } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { str, type FormState } from "@/lib/form";
import {
  EXPIRY_PRESETS,
  expiryFromPreset,
  linkSettingsSchema,
  normalizeAllowEntry,
  validateLinkSettings,
} from "@/lib/access/settings";

const slugId = customAlphabet("abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", 12);

const payloadSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Give the link a name.").max(200),
  folderIds: z.array(z.string().uuid()).max(500),
  documentIds: z.array(z.string().uuid()).max(500),
  settings: linkSettingsSchema,
  allowListEntries: z.array(z.string().max(320)).max(1000),
  password: z.string().max(200), // blank = keep existing
  agreementId: z.string().uuid().nullable(),
  expiryPreset: z.enum(EXPIRY_PRESETS),
  expiryCustom: z.string().nullable(),
});

export type LinkPayload = z.infer<typeof payloadSchema>;

export async function saveLink(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("links.settings");
  if (!user) return { error: "You don't have permission to change links." };

  let raw: unknown;
  try {
    raw = JSON.parse(str(fd, "payload"));
  } catch {
    return { error: "Invalid form data." };
  }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid form data." };
  const p = parsed.data;

  if (p.folderIds.length + p.documentIds.length === 0) return { error: "Choose at least one file or folder to share." };

  const db = await getDb();
  const existing = p.id
    ? (await db.select().from(schema.links).where(and(eq(schema.links.id, p.id), isNull(schema.links.deletedAt))).limit(1))[0]
    : null;
  if (p.id && !existing) return { error: "This link no longer exists." };

  const expiresAt =
    p.expiryPreset === "custom" ? expiryFromPreset("custom", p.expiryCustom) : p.expiryPreset === "never" ? null : expiryFromPreset(p.expiryPreset, null);
  if (p.expiryPreset === "custom" && !expiresAt) return { error: "Pick a valid expiry date." };
  // keep the original expiry if the preset was not changed on an existing link
  const keepExpiry = existing && p.expiryPreset === "custom" && p.expiryCustom === existing.expiresAt?.toISOString();

  const newPassword = p.password.trim();
  if (newPassword && newPassword.length < 6) return { error: "Link passwords need at least 6 characters." };
  const hasPassword = !!newPassword || !!existing?.passwordHash;

  const allowEntries = [...new Set(p.allowListEntries.map(normalizeAllowEntry).filter(Boolean))];
  const settings = { ...p.settings };
  if (!settings.questionnaire.enabled) settings.questionnaire = { enabled: false, questions: [] };

  const issues = validateLinkSettings(settings, {
    allowListEntries: allowEntries,
    hasPassword,
    agreementId: settings.requireNda ? p.agreementId : null,
    expiresAt: keepExpiry ? null : expiresAt,
  });
  if (issues.length) return { error: issues.map((i) => i.message).join(" ") };

  // only real, existing items can be shared
  const folderIds = p.folderIds.length
    ? (await db.select({ id: schema.folders.id }).from(schema.folders).where(inArray(schema.folders.id, p.folderIds))).map((r) => r.id)
    : [];
  const documentIds = p.documentIds.length
    ? (await db.select({ id: schema.documents.id }).from(schema.documents).where(inArray(schema.documents.id, p.documentIds))).map((r) => r.id)
    : [];

  // Changing the password bumps its version, so visitors who entered the old one are asked again.
  const passwordHash = !settings.requirePassword
    ? null
    : newPassword
      ? await hashPassword(newPassword)
      : (existing?.passwordHash ?? null);
  const passwordVersion = (existing?.passwordVersion ?? 0) + (newPassword ? 1 : 0);

  const values = {
    name: p.name,
    settings,
    expiresAt: keepExpiry ? existing!.expiresAt : expiresAt,
    agreementId: settings.requireNda ? p.agreementId : null,
    passwordHash,
    passwordVersion,
  };

  const linkId = await db.transaction(async (tx) => {
    let id: string;
    if (existing) {
      await tx.update(schema.links).set(values).where(eq(schema.links.id, existing.id));
      id = existing.id;
      await tx.delete(schema.linkScope).where(eq(schema.linkScope.linkId, id));
      await tx.delete(schema.allowedEmails).where(eq(schema.allowedEmails.linkId, id));
    } else {
      const [created] = await tx
        .insert(schema.links)
        .values({ ...values, slug: slugId(), createdBy: user.id })
        .returning();
      id = created.id;
    }
    const scope = [
      ...folderIds.map((folderId) => ({ linkId: id, folderId })),
      ...documentIds.map((documentId) => ({ linkId: id, documentId })),
    ];
    if (scope.length) await tx.insert(schema.linkScope).values(scope);
    if (settings.allowList && allowEntries.length) {
      await tx.insert(schema.allowedEmails).values(allowEntries.map((emailOrDomain) => ({ linkId: id, emailOrDomain })));
    }
    return id;
  });

  await audit({
    actor: { type: "user", id: user.id, label: user.email },
    action: existing ? "link.update" : "link.create",
    targetType: "link",
    targetId: linkId,
    metadata: {
      name: p.name,
      settings,
      expiresAt: values.expiresAt?.toISOString() ?? null,
      folders: folderIds.length,
      documents: documentIds.length,
      passwordChanged: !!newPassword,
    },
  });

  revalidatePath("/links");
  if (existing) return { success: "Link saved." };
  redirect(`/links/${linkId}?created=1`);
}

/** FR-29: disabling takes effect on the visitor's very next request. */
export async function setLinkStatus(fd: FormData): Promise<void> {
  const user = await userCan("links.settings");
  if (!user) return;
  const id = str(fd, "id");
  const status = str(fd, "status") === "active" ? "active" : "disabled";
  const db = await getDb();
  await db.update(schema.links).set({ status }).where(eq(schema.links.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: status === "active" ? "link.enable" : "link.disable", targetType: "link", targetId: id });
  revalidatePath(`/links/${id}`);
  revalidatePath("/links");
}

/** Soft delete: analytics and audit history stay; the link stops working immediately. */
export async function deleteLink(fd: FormData): Promise<void> {
  const user = await userCan("links.settings");
  if (!user) return;
  const id = str(fd, "id");
  const db = await getDb();
  await db.update(schema.links).set({ deletedAt: new Date(), status: "disabled" }).where(eq(schema.links.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "link.delete", targetType: "link", targetId: id });
  revalidatePath("/links");
  redirect("/links");
}
