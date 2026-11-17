"use client";

import { savePrefsAction } from "@/app/actions/account";
import { setPrefWriteListener } from "./client-store";
import { isSyncedPrefKey, PREF_PREFIX, type PrefValues } from "./synced-prefs";

/**
 * Sends this browser's preference changes to the signed-in account.
 *
 * Changes are gathered for a moment and sent together — dragging a place
 * up the list several times is one request — and sent at once when the tab
 * is hidden, so closing it rarely loses one. A change that fails to send
 * (offline, server restarting) stays pending and goes with the next one, or
 * with the next fetch of the account (pref-reconcile.ts).
 *
 * Only the tab that made a change sends it; other tabs pick it up from
 * localStorage's `storage` event like they always have.
 */

const OWNER_KEY = `${PREF_PREFIX}:account:v1`;
const DEBOUNCE_MS = 400;

let active = false;
let onSignedOut: (() => void) | null = null;
const pending = new Map<string, string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

/** Whose preferences this browser holds: the account's username, or null when signed out. */
export function readOwner(): string | null {
  try {
    return window.localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

export function writeOwner(username: string | null): void {
  try {
    if (username === null) window.localStorage.removeItem(OWNER_KEY);
    else window.localStorage.setItem(OWNER_KEY, username);
  } catch {
    // Storage blocked: every load reconciles from scratch, which is still correct.
  }
}

export function pendingKeys(): Set<string> {
  return new Set(pending.keys());
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushPrefs(), DEBOUNCE_MS);
}

/** Start sending changes. `signedOut` is called if the server says the session has ended. */
export function startSyncing(signedOut: () => void): void {
  active = true;
  onSignedOut = signedOut;
  setPrefWriteListener((key, json) => {
    if (!isSyncedPrefKey(key)) return;
    pending.set(key, json);
    schedule();
  });
}

/** Stop, dropping anything unsent — for signing out, or switching accounts. */
export function stopSyncing(): void {
  active = false;
  onSignedOut = null;
  pending.clear();
  if (timer) clearTimeout(timer);
  timer = null;
  setPrefWriteListener(null);
}

export function queueUpload(values: PrefValues): void {
  if (!active) return;
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  for (const [key, json] of entries) pending.set(key, json);
  schedule();
}

/** Sends whatever is pending now. Never throws. */
export async function flushPrefs(): Promise<void> {
  if (inFlight) await inFlight;
  if (!active || pending.size === 0) return;
  if (timer) clearTimeout(timer);
  timer = null;
  const batch = Object.fromEntries(pending);
  inFlight = (async () => {
    try {
      const result = await savePrefsAction(batch);
      if (result.ok) {
        // A key changed again while this was in flight stays pending.
        for (const [key, json] of Object.entries(batch)) if (pending.get(key) === json) pending.delete(key);
      } else if (result.signedOut) {
        onSignedOut?.();
      }
    } catch {
      // Offline or restarting: it stays pending for the next try.
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

/** Before signing in, out, or deleting: send this account's last changes, then let go of it. */
export async function releaseAccount(): Promise<void> {
  await flushPrefs();
  stopSyncing();
}
