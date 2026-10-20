import { redirect } from "next/navigation";
import { getPartialSession } from "@/lib/auth/session";
import { ensurePendingTotpSecret } from "@/lib/auth/two-factor";
import { totpQrDataUrl } from "@/lib/auth/totp";
import { getBrand } from "@/lib/workspace";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, Input } from "@/components/ui";
import { confirmTwoFactorSetup } from "../../actions";

export const metadata = { title: "Set up two-factor" };

export default async function SetupTwoFactorPage() {
  const row = await getPartialSession();
  if (!row) redirect("/login");
  if (row.user.twoFactorEnabled) redirect(row.session.twoFactorPassed ? "/" : "/login/verify");

  const secret = await ensurePendingTotpSecret(row.user.id);
  const brand = await getBrand();
  const qr = await totpQrDataUrl(secret, row.user.email, `${brand.companyName} Data Room`);

  return (
    <>
      <h1 className="text-lg font-semibold">Set up two-factor authentication</h1>
      <p className="mt-1 text-sm text-stone-500">
        Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…), then enter the
        6-digit code it shows.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for your authenticator app" width={220} height={220} className="mx-auto my-4" />
      <p className="mb-4 text-center text-xs text-stone-500">
        Can&apos;t scan? Enter this key: <code className="break-all font-mono text-stone-800">{secret}</code>
      </p>
      <ActionForm action={confirmTwoFactorSetup} className="space-y-4">
        <Field label="Code" htmlFor="code">
          <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
        </Field>
        <SubmitButton className="w-full" pendingText="Checking…">
          Turn on and continue
        </SubmitButton>
      </ActionForm>
    </>
  );
}
