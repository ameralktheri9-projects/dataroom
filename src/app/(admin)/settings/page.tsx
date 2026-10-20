import { getBrand } from "@/lib/workspace";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Field, Input } from "@/components/ui";
import { saveBrand } from "./actions";

export const metadata = { title: "Brand settings" };

export default async function BrandSettingsPage() {
  const brand = await getBrand();
  return (
    <Card className="max-w-xl p-5">
      <p className="mb-4 text-sm text-stone-500">Shown on visitor pages and in emails.</p>
      <ActionForm action={saveBrand} className="space-y-4">
        <Field label="Company name" htmlFor="companyName">
          <Input id="companyName" name="companyName" defaultValue={brand.companyName} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Header colour" htmlFor="primaryColor">
            <Input id="primaryColor" name="primaryColor" type="color" defaultValue={brand.primaryColor} className="p-1" />
          </Field>
          <Field label="Button colour" htmlFor="accentColor">
            <Input id="accentColor" name="accentColor" type="color" defaultValue={brand.accentColor} className="p-1" />
          </Field>
        </div>
        <Field label="Logo" htmlFor="logo" hint="PNG or JPEG, under 1 MB.">
          {brand.logoKey && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/api/brand/logo" alt="Current logo" className="mb-2 h-10 w-auto rounded border border-stone-200 p-1" />
          )}
          <Input id="logo" name="logo" type="file" accept="image/png,image/jpeg" className="py-1.5" />
          {brand.logoKey && (
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" name="removeLogo" /> Remove logo
            </label>
          )}
        </Field>
        <SubmitButton>Save brand</SubmitButton>
      </ActionForm>
    </Card>
  );
}
