"use client";

import { useEffect } from "react";
import Link from "next/link";

/** Route-level error boundary. Feed failures are handled in place; this is for the unexpected. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[outside] unhandled route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <h1 className="text-3xl font-bold tracking-tight">Something broke</h1>
      <p className="mt-3 text-muted">That&apos;s on us. Trying again often clears it.</p>
      <div className="mt-8 flex gap-3">
        <button type="button" onClick={reset} className="rounded-full bg-text px-4 py-2 text-sm font-medium text-ink">
          Try again
        </button>
        <Link href="/" className="rounded-full border border-line bg-surface px-4 py-2 text-sm hover:border-muted-dim">
          Back to the map
        </Link>
      </div>
    </div>
  );
}
