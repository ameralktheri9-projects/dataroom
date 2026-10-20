import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Link, Visitor } from "@/lib/db/schema";
import { evaluateAccess, type ApprovalState, type GateStep } from "./engine";
import { linkSettingsSchema } from "./settings";
import { readVisitorSession, type VisitorSession } from "./visitor-session";

export type ResolvedAccess = {
  link: Link;
  step: GateStep;
  session: VisitorSession;
  visitor: Visitor | null;
};

export async function findLinkBySlug(slug: string): Promise<Link | null> {
  const db = await getDb();
  const [link] = await db.select().from(schema.links).where(eq(schema.links.slug, slug)).limit(1);
  if (!link) return null;
  // tolerate settings saved by older versions of the app
  return { ...link, settings: linkSettingsSchema.parse(link.settings ?? {}) };
}

export async function latestRequest(visitorId: string, linkId: string, type: "access" | "download", documentId?: string) {
  const db = await getDb();
  const conds = [
    eq(schema.accessRequests.visitorId, visitorId),
    eq(schema.accessRequests.linkId, linkId),
    eq(schema.accessRequests.type, type),
  ];
  if (documentId) conds.push(eq(schema.accessRequests.documentId, documentId));
  const [row] = await db
    .select()
    .from(schema.accessRequests)
    .where(and(...conds))
    .orderBy(desc(schema.accessRequests.createdAt))
    .limit(1);
  return row ?? null;
}

export function approvalOf(req: { status: "pending" | "approved" | "rejected" } | null): ApprovalState {
  return req ? req.status : "none";
}

/** Loads everything the engine needs from the database and decides the visitor's current step. */
export async function resolveAccess(link: Link): Promise<ResolvedAccess> {
  const db = await getDb();
  const session = await readVisitorSession(link.id);
  const s = link.settings;

  let visitor: Visitor | null = null;
  if (session.email) {
    [visitor] = await db.select().from(schema.visitors).where(eq(schema.visitors.email, session.email)).limit(1);
    visitor ??= null;
  }

  const allowList = s.allowList
    ? (await db.select().from(schema.allowedEmails).where(eq(schema.allowedEmails.linkId, link.id))).map(
        (r) => r.emailOrDomain,
      )
    : [];

  let ndaSigned = false;
  if (s.requireNda && visitor && link.agreementId) {
    const [sig] = await db
      .select({ id: schema.signatures.id })
      .from(schema.signatures)
      .where(and(eq(schema.signatures.visitorId, visitor.id), eq(schema.signatures.agreementId, link.agreementId)))
      .limit(1);
    ndaSigned = !!sig;
  }

  let questionnaireDone = false;
  if (s.questionnaire.enabled && visitor) {
    const [ans] = await db
      .select({ id: schema.questionnaireAnswers.id })
      .from(schema.questionnaireAnswers)
      .where(and(eq(schema.questionnaireAnswers.visitorId, visitor.id), eq(schema.questionnaireAnswers.linkId, link.id)))
      .limit(1);
    questionnaireDone = !!ans;
  }

  const approval = s.requireApproval && visitor ? approvalOf(await latestRequest(visitor.id, link.id, "access")) : "none";

  const step = evaluateAccess({
    now: new Date(),
    link: {
      status: link.status,
      deleted: !!link.deletedAt,
      expiresAt: link.expiresAt,
      settings: s,
      passwordVersion: link.passwordVersion,
    },
    allowList,
    session: { email: session.email, emailVerified: session.emailVerified, passwordVersion: session.passwordVersion },
    visitor: visitor ? { status: visitor.status } : null,
    ndaSigned,
    questionnaireDone,
    approval,
  });

  return { link, step, session, visitor };
}
