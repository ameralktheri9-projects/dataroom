"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, max } from "drizzle-orm";
import { nanoid } from "nanoid";
import { PDFDocument } from "pdf-lib";
import { userCan, destroyAllSessionsFor } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import type { Role } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { randomToken, sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { inviteEmail } from "@/lib/email/templates";
import { assignableRoles, ROLE_LABELS } from "@/lib/permissions";
import { storage } from "@/lib/storage";
import { getBrand, getWorkspaceSettings } from "@/lib/workspace";
import { normalizeEmail, str, type FormState } from "@/lib/form";
import { isValidEmail } from "@/lib/access/settings";

const NOT_ALLOWED: FormState = { error: "Only Owners and Admins can change settings." };
const HEX = /^#[0-9a-f]{6}$/i;

// ---------------------------------------------------------------- brand (FR-80)

export async function saveBrand(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("workspace.manage");
  if (!user) return NOT_ALLOWED;
  const companyName = str(fd, "companyName").slice(0, 120);
  const primaryColor = str(fd, "primaryColor");
  const accentColor = str(fd, "accentColor");
  if (!companyName) return { error: "Enter the company name." };
  if (!HEX.test(primaryColor) || !HEX.test(accentColor)) return { error: "Colours must look like #1c1917." };

  const ws = await getWorkspaceSettings();
  let logoKey = ws.brand.logoKey ?? null;
  const logo = fd.get("logo");
  if (logo instanceof File && logo.size > 0) {
    if (logo.size > 1024 * 1024) return { error: "The logo must be under 1 MB." };
    const ext = logo.type === "image/png" ? "png" : logo.type === "image/jpeg" ? "jpg" : null;
    if (!ext) return { error: "Upload the logo as PNG or JPEG." };
    logoKey = `brand/logo-${nanoid(10)}.${ext}`;
    await storage().put(logoKey, new Uint8Array(await logo.arrayBuffer()), logo.type);
  }
  if (fd.get("removeLogo") === "on") logoKey = null;

  const db = await getDb();
  const brand = { companyName, primaryColor, accentColor, logoKey };
  await db.update(schema.settings).set({ brand }).where(eq(schema.settings.id, ws.id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "settings.brand", metadata: brand });
  revalidatePath("/", "layout");
  return { success: "Brand saved." };
}

// ---------------------------------------------------------------- team (FR-02)

export async function inviteMember(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("workspace.manage");
  if (!user) return NOT_ALLOWED;
  const email = normalizeEmail(str(fd, "email"));
  const role = str(fd, "role") as Role;
  if (!isValidEmail(email)) return { error: "Enter a valid email." };
  if (!assignableRoles(user.role).includes(role)) return { error: "You can't give that role." };

  const db = await getDb();
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing?.status === "active") return { error: "That person is already on the team." };

  // one open invite per email
  await db.delete(schema.invites).where(and(eq(schema.invites.email, email), isNull(schema.invites.acceptedAt)));
  const token = randomToken();
  await db.insert(schema.invites).values({
    email,
    role,
    tokenHash: sha256(token),
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  });
  const url = `${env().APP_URL}/invite/${token}`;
  const sent = await sendEmail({ to: email, ...inviteEmail(await getBrand(), { inviter: user.name, role: ROLE_LABELS[role], url }) });
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "team.invite", metadata: { email, role } });
  revalidatePath("/settings/team");
  return { success: sent ? `Invitation sent to ${email}.` : `Email failed. Send this link to ${email} yourself: ${url}` };
}

export async function revokeInvite(fd: FormData): Promise<void> {
  const user = await userCan("workspace.manage");
  if (!user) return;
  const id = str(fd, "id");
  const db = await getDb();
  await db.delete(schema.invites).where(eq(schema.invites.id, id));
  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "team.invite_revoke", targetId: id, targetType: "invite" });
  revalidatePath("/settings/team");
}

export async function updateMember(fd: FormData): Promise<void> {
  const user = await userCan("workspace.manage");
  if (!user) return;
  const id = str(fd, "id");
  if (id === user.id) return; // nobody changes their own role or locks themselves out
  const db = await getDb();
  const [target] = await db.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!target || target.role === "owner") return;
  // Admins manage editors/viewers only; the Owner manages everyone below Owner.
  if (!assignableRoles(user.role).includes(target.role)) return;

  const role = str(fd, "role") as Role;
  const status = str(fd, "status");
  if (role && assignableRoles(user.role).includes(role) && role !== target.role) {
    await db.update(schema.users).set({ role }).where(eq(schema.users.id, id));
    await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "team.role_change", targetType: "user", targetId: id, metadata: { from: target.role, to: role } });
  }
  if (status === "disabled" || status === "active") {
    await db.update(schema.users).set({ status }).where(eq(schema.users.id, id));
    if (status === "disabled") await destroyAllSessionsFor(id);
    await audit({ actor: { type: "user", id: user.id, label: user.email }, action: status === "disabled" ? "team.disable" : "team.enable", targetType: "user", targetId: id });
  }
  if (fd.get("reset2fa") === "on") {
    await db.update(schema.users).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(schema.users.id, id));
    await destroyAllSessionsFor(id);
    await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "team.reset_2fa", targetType: "user", targetId: id });
  }
  revalidatePath("/settings/team");
}

// ---------------------------------------------------------------- agreements (FR-60)

export async function uploadAgreement(_: FormState, fd: FormData): Promise<FormState> {
  const user = await userCan("workspace.manage");
  if (!user) return NOT_ALLOWED;
  const name = str(fd, "name").slice(0, 200);
  const file = fd.get("file");
  if (!name) return { error: "Name the agreement, e.g. Mutual NDA." };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF." };
  if (file.size > 10 * 1024 * 1024) return { error: "The PDF must be under 10 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return { error: "That file is not a readable PDF." };
  }

  const db = await getDb();
  const [{ latest }] = await db.select({ latest: max(schema.agreements.version) }).from(schema.agreements).where(eq(schema.agreements.name, name));
  const version = (latest ?? 0) + 1;
  const key = `agreements/${nanoid(16)}.pdf`;
  await storage().put(key, bytes, "application/pdf");

  const created = await db.transaction(async (tx) => {
    // Older versions stay (signatures point at what was signed) but stop being offered.
    const previous = await tx
      .update(schema.agreements)
      .set({ isCurrent: false })
      .where(and(eq(schema.agreements.name, name), eq(schema.agreements.isCurrent, true)))
      .returning({ id: schema.agreements.id });
    const [a] = await tx.insert(schema.agreements).values({ name, version, storageKey: key, uploadedBy: user.id }).returning();
    // links using the previous version move to the new one, so visitors accept the latest text
    for (const p of previous) await tx.update(schema.links).set({ agreementId: a.id }).where(eq(schema.links.agreementId, p.id));
    return a;
  });

  await audit({ actor: { type: "user", id: user.id, label: user.email }, action: "agreement.upload", targetType: "agreement", targetId: created.id, metadata: { name, version } });
  revalidatePath("/settings/agreements");
  return { success: version > 1 ? `Version ${version} of "${name}" uploaded. Links now ask for this version.` : `"${name}" uploaded.` };
}
