import type { Metadata } from "next";
import { AlertsList } from "@/components/AlertsList";
import { PageBody } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Alerts" };

export default function AlertsPage() {
  return (
    <PageBody>
      <AlertsList />
    </PageBody>
  );
}
