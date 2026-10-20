import "server-only";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many attempts. Please wait and try again.");
  }
}

/**
 * Fixed-window counter stored in Postgres (NFR-03), so it holds across serverless instances.
 * Throws RateLimitError when `key` has been hit more than `limit` times in `windowSeconds`.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const db = await getDb();
  const [row] = await db
    .insert(schema.rateLimits)
    .values({ key, count: 1, windowStart: new Date() })
    .onConflictDoUpdate({
      target: schema.rateLimits.key,
      set: {
        count: sql`CASE WHEN ${schema.rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE ${schema.rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${schema.rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE ${schema.rateLimits.windowStart} END`,
      },
    })
    .returning({ count: schema.rateLimits.count, windowStart: schema.rateLimits.windowStart });

  if (row.count > limit) {
    const elapsed = (Date.now() - row.windowStart.getTime()) / 1000;
    throw new RateLimitError(Math.max(1, Math.ceil(windowSeconds - elapsed)));
  }
}

export const LIMITS = {
  login: { limit: 10, window: 15 * 60 },
  twoFactor: { limit: 10, window: 15 * 60 },
  linkPassword: { limit: 10, window: 15 * 60 },
  sendCode: { limit: 5, window: 15 * 60 },
  checkCode: { limit: 10, window: 15 * 60 },
} as const;
