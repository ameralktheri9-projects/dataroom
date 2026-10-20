import "server-only";
import { getDb, schema } from "@/lib/db";
import type { Brand } from "@/lib/db/schema";

export const DEFAULT_BRAND: Brand = {
  companyName: "Data Room",
  primaryColor: "#1c1917",
  accentColor: "#2563eb",
  logoKey: null,
};

/** The single workspace settings row (BRD assumes one workspace). */
export async function getWorkspaceSettings() {
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.settings).values({ brand: DEFAULT_BRAND }).returning();
  return created;
}

export async function getBrand(): Promise<Brand> {
  const s = await getWorkspaceSettings();
  return { ...DEFAULT_BRAND, ...s.brand };
}
