"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this page is a secure context.
 *
 * Location and notifications only exist in one: on `localhost` and on the
 * HTTPS tailnet address, but not on the plain-HTTP local-network address.
 * The server snapshot says "secure" so nothing flashes a warning during
 * hydration on the addresses where everything works.
 */
export function useSecureContext(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => window.isSecureContext,
    () => true,
  );
}
