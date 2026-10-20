import { requireUser } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  await requireUser("workspace.manage");
  return (
    <>
      <PageHeader title="Settings" />
      <SettingsTabs />
      {children}
    </>
  );
}
