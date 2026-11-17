import type { PrefValues } from "./synced-prefs";

/**
 * How this browser's preferences and an account's are brought together each
 * time the account is fetched (on load, and on coming back to the tab).
 *
 * - The account wins for every key it has — except one with a change from
 *   this browser still on its way up, which would otherwise flicker back.
 * - A key the account lacks but this browser has goes up. That's what moves
 *   a browser's places and settings into an account the first time it signs
 *   in, and what retries a change whose upload failed.
 * - Switching from one account to another starts from nothing, so the first
 *   account's places never leak into the second's.
 */

export interface Reconciled {
  /** Written into this browser. */
  apply: PrefValues;
  /** Sent to the account. */
  upload: PrefValues;
  /** Wipe this browser's copy before applying. */
  clearFirst: boolean;
}

export function reconcilePrefs(input: {
  local: PrefValues;
  account: PrefValues;
  /** Keys changed here and not yet confirmed saved. */
  pending: ReadonlySet<string>;
  /** Who this browser's copy belonged to, or null if nobody (signed out). */
  previousUser: string | null;
  user: string;
}): Reconciled {
  const { account, pending, previousUser, user } = input;
  const switched = previousUser !== null && previousUser !== user;
  const local = switched ? {} : input.local;

  const apply: PrefValues = {};
  for (const [key, value] of Object.entries(account)) {
    if (!pending.has(key)) apply[key] = value;
  }
  const upload: PrefValues = {};
  for (const [key, value] of Object.entries(local)) {
    if (!(key in account) || pending.has(key)) upload[key] = value;
  }
  return { apply, upload, clearFirst: switched };
}
