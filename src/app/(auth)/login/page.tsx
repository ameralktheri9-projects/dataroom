import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { login } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");

  return (
    <>
      <h1 className="mb-5 text-lg font-semibold">Sign in</h1>
      <ActionForm action={login} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </Field>
        <SubmitButton className="w-full" pendingText="Signing in…">
          Continue
        </SubmitButton>
      </ActionForm>
    </>
  );
}
