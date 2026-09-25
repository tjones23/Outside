import type { Metadata } from "next";
import { PageBody } from "@/components/PageHeader";
import { SettingsPanel } from "@/components/SettingsPanel";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageBody>
      <SettingsPanel />
    </PageBody>
  );
}
