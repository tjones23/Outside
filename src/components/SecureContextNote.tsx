"use client";

import { useSecureContext } from "./providers/useSecureContext";

/**
 * Explains why location and notifications are missing on the plain-HTTP
 * local-network address. Browsers only offer them to a secure context, which
 * `localhost` and the HTTPS tailnet address are and a LAN IP is not.
 */
export function SecureContextNote({ feature }: { feature: string }) {
  const secure = useSecureContext();
  if (secure) return null;
  return (
    <p className="rounded-xl border border-watch/30 bg-watch/10 px-4 py-3 text-sm text-text">
      {feature} need HTTPS. This local-network address is plain HTTP, and browsers don&apos;t allow{" "}
      {feature.toLowerCase()} there — open Outside at its tailnet address (https://…ts.net:8443) instead.
    </p>
  );
}
