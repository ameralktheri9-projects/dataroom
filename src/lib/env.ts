import "server-only";
import { z } from "zod";

const schema = z.object({
  // Neon connection string (postgres://…). Use "pglite:./.data/pglite" for a local, in-process database.
  DATABASE_URL: z.string().min(1),
  // 32+ random bytes; signs visitor cookies and local file URLs.
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./.data/uploads"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.string().optional(), // set for Cloudflare R2
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  EMAIL_DRIVER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Data Room <dataroom@example.com>"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${msg}\nSee .env.example.`);
  }
  const e = parsed.data;
  if (e.STORAGE_DRIVER === "s3" && (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY)) {
    throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY");
  }
  if (e.EMAIL_DRIVER === "resend" && !e.RESEND_API_KEY) {
    throw new Error("EMAIL_DRIVER=resend requires RESEND_API_KEY");
  }
  cached = e;
  return e;
}
