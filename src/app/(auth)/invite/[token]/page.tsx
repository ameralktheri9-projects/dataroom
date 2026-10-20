import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { sha256 } from "@/lib/crypto";
import { ROLE_LABELS } from "@/lib/permissions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Field, Input } from "@/components/ui";
import { acceptInvite } from "../../actions";

export const metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const db = await getDb();
  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(and(eq(schema.invites.tokenHash, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
    .limit(1);

  if (!invite) {
    return <Alert tone="red">This invitation is invalid or has expired. Ask the person who invited you for a new one.</Alert>;
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Join the data room</h1>
      <p className="mt-1 mb-5 text-sm text-stone-500">
        {invite.email} · {ROLE_LABELS[invite.role]}
      </p>
      <ActionForm action={acceptInvite} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" required autoComplete="name" />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 12 characters, letters and numbers.">
          <Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
        </Field>
        <SubmitButton className="w-full">Create account</SubmitButton>
      </ActionForm>
    </>
  );
}
