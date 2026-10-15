import type { Metadata } from "next";
import { PageBody } from "@/components/PageHeader";
import { Places } from "@/components/Places";

export const metadata: Metadata = { title: "Places" };

export default function LocationsPage() {
  return (
    <PageBody>
      <Places />
    </PageBody>
  );
}
