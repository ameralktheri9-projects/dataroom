import { redirect } from "next/navigation";
import { getPartialSession } from "@/lib/auth/session";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { logout, verifyTwoFactor } from "../../actions";

export const metadata = { title: "Two-factor code" };

export default async function VerifyPage() {
  const row = await getPartialSession();
  if (!row) redirect("/login");
  if (row.session.twoFactorPassed) redirect("/");
  if (!row.user.twoFactorEnabled) redirect("/login/setup-2fa");

  return (
    <>
      <h1 className="text-lg font-semibold">Two-factor code</h1>
      <p className="mt-1 mb-5 text-sm text-stone-500">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={verifyTwoFactor} className="space-y-4">
        <Field label="Code" htmlFor="code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
        </Field>
        <SubmitButton className="w-full" pendingText="Checking…">
          Verify
        </SubmitButton>
      </ActionForm>
      <form action={logout} className="mt-4 text-center">
        <button className="text-sm text-stone-500 hover:underline">Use a different account</button>
      </form>
    </>
  );
}
