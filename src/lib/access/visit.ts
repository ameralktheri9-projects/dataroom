import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { VisitorSession } from "./visitor-session";

// A visit is one sitting. After this long a returning visitor starts a new visit (and a new open notification).
export const VISIT_MAX_AGE_MS = 12 * 3600 * 1000;

export async function currentVisit(session: VisitorSession) {
  if (!session.visitId) return null;
  const db = await getDb();
  const [visit] = await db.select().from(schema.visits).where(eq(schema.visits.id, session.visitId)).limit(1);
  if (!visit || visit.linkId !== session.linkId) return null;
  if (visit.visitorId !== (session.visitorId ?? null)) return null;
  if (Date.now() - visit.startedAt.getTime() > VISIT_MAX_AGE_MS) return null;
  return visit;
}
