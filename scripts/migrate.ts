// Applies pending migrations in ./drizzle. Runs locally and in the Vercel build (see package.json "build").
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not set. On Vercel, connect the Neon integration (Storage tab) and redeploy.");

  if (url.startsWith("pglite:")) {
    const { mkdirSync } = await import("node:fs");
    const dir = url.slice("pglite:".length);
    mkdirSync(dir, { recursive: true });
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(dir);
    await migrate(drizzle({ client }), { migrationsFolder: "./drizzle" });
    await client.close();
  } else {
    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    // Migrations need a direct (non-pooled) connection; prefer DATABASE_URL_UNPOOLED when Neon's Vercel integration sets it.
    const client = postgres(process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || url, { max: 1 });
    await migrate(drizzle({ client }), { migrationsFolder: "./drizzle" });
    await client.end();
  }
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
