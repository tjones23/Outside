import type { Metadata } from "next";
import { AccountPanel } from "@/components/AccountPanel";
import { PageBody, PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Account" };

/** Creating an Outside account, signing in, and the account's passkeys. */
export default function AccountPage() {
  return (
    <PageBody>
      <div className="mx-auto max-w-lg">
        <PageHeader title="Your Outside account" subtitle="Optional. Without one, everything still works and stays in this browser." />
        <AccountPanel />
      </div>
    </PageBody>
  );
}
