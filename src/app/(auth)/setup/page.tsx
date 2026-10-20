import { redirect } from "next/navigation";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { setupOwner } from "../actions";

export const metadata = { title: "Set up" };

export default async function SetupPage() {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n > 0) redirect("/login");

  return (
    <>
      <h1 className="text-lg font-semibold">Set up your data room</h1>
      <p className="mt-1 mb-5 text-sm text-stone-500">Create the Owner account. You will add two-factor authentication next.</p>
      <ActionForm action={setupOwner} className="space-y-4">
        <Field label="Company name" htmlFor="company">
          <Input id="company" name="company" required autoComplete="organization" />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" required autoComplete="name" />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 12 characters, letters and numbers.">
          <Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
        </Field>
        <SubmitButton className="w-full" pendingText="Creating…">
          Create Owner account
        </SubmitButton>
      </ActionForm>
    </>
  );
}
