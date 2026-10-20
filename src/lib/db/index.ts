import "server-only";
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { connection } from "next/server";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type DB = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __db?: Promise<DB> };

async function connect(): Promise<DB> {
  const url = env().DATABASE_URL;
  if (url.startsWith("pglite:")) {
    // Local development without a Postgres server. The query builder API is identical.
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite(url.slice("pglite:".length));
    return drizzle({ client, schema }) as unknown as DB;
  }
  // Neon: use the pooled connection string (…-pooler…). prepare:false is required behind PgBouncer.
  const client = postgres(url, { prepare: false, max: 5 });
  return drizzlePostgres({ client, schema });
}

/** Every query is per-request data, so this also opts the calling page out of build-time prerendering. */
export async function getDb(): Promise<DB> {
  await connection();
  globalForDb.__db ??= connect();
  return globalForDb.__db;
}

export { schema };
