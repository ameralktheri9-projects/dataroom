import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";

// Applies the real migrations to an in-memory Postgres and checks database-level guarantees.

const client = new PGlite();
const db = drizzle({ client, schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
}, 60_000);

describe("audit log (NFR-12)", () => {
  it("accepts inserts", async () => {
    const [row] = await db
      .insert(schema.auditLog)
      .values({ actorType: "system", action: "test.insert" })
      .returning();
    expect(row.action).toBe("test.insert");
  });

  it("rejects updates, deletes and truncation", async () => {
    const [row] = await db.insert(schema.auditLog).values({ actorType: "system", action: "test.immutable" }).returning();
    await expect(
      db.update(schema.auditLog).set({ action: "tampered" }).where(eq(schema.auditLog.id, row.id)),
    ).rejects.toThrow();
    await expect(db.delete(schema.auditLog).where(eq(schema.auditLog.id, row.id))).rejects.toThrow();
    await expect(client.exec("TRUNCATE audit_log")).rejects.toThrow();
    const [still] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.id, row.id));
    expect(still.action).toBe("test.immutable");
  });
});

describe("schema", () => {
  it("keeps one visitor per email", async () => {
    await db.insert(schema.visitors).values({ email: "dup@fund.com" });
    await expect(db.insert(schema.visitors).values({ email: "dup@fund.com" })).rejects.toThrow();
  });
});
