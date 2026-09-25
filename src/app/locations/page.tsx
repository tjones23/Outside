import type { Metadata } from "next";
import { PageBody } from "@/components/PageHeader";
import { SavedLocations } from "@/components/SavedLocations";

export const metadata: Metadata = { title: "Places" };

export default function LocationsPage() {
  return (
    <PageBody>
      <SavedLocations />
    </PageBody>
  );
}
