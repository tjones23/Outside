import type { Metadata } from "next";
import { PageBody } from "@/components/PageHeader";
import { ReportsList } from "@/components/ReportsList";

export const metadata: Metadata = { title: "Storm reports" };

export default function ReportsPage() {
  return (
    <PageBody>
      <ReportsList />
    </PageBody>
  );
}
