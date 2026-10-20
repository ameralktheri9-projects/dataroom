import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Link } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/email";
import { linkOpenedEmail, requestCreatedEmail } from "@/lib/email/templates";
import { getBrand } from "@/lib/workspace";

async function linkOwnerEmail(link: Link): Promise<string | null> {
  if (!link.createdBy) return null;
  const db = await getDb();
  const [u] = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.id, link.createdBy), eq(schema.users.status, "active")))
    .limit(1);
  return u?.email ?? null;
}

/** FR-28: email the link owner on every open, unless muted for this link. */
export async function notifyLinkOpened(link: Link, visitor: string, country: string | null): Promise<void> {
  if (!link.settings.notifyOnOpen) return;
  const to = await linkOwnerEmail(link);
  if (!to) return;
  const brand = await getBrand();
  const msg = linkOpenedEmail(brand, {
    linkName: link.name,
    visitor,
    country,
    at: new Date(),
    url: `${env().APP_URL}/links/${link.id}`,
  });
  await sendEmail({ to, ...msg });
}

/** New access/download request: tell the link owner and everyone who can decide requests. */
export async function notifyRequest(
  link: Link,
  p: { kind: "access" | "download"; visitor: string; documentName?: string },
): Promise<void> {
  const db = await getDb();
  const deciders = await db
    .select({ email: schema.users.email })
    .from(schema.users)
    .where(and(inArray(schema.users.role, ["owner", "admin"]), eq(schema.users.status, "active")));
  const owner = await linkOwnerEmail(link);
  const recipients = new Set([...deciders.map((d) => d.email), ...(owner ? [owner] : [])]);
  const brand = await getBrand();
  const msg = requestCreatedEmail(brand, { ...p, linkName: link.name, url: `${env().APP_URL}/` });
  await Promise.all([...recipients].map((to) => sendEmail({ to, ...msg })));
}
