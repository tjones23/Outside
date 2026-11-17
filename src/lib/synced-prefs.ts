import { THEME_STORAGE_KEY } from "./theme";

/**
 * The preferences an account carries, by their localStorage key.
 *
 * Shared by the browser (client-store.ts, account-sync.ts) and the server
 * (server/accounts.ts), so the two agree on what may be stored. The server
 * only checks shape and size; what a value *means* is checked where it's
 * read, by client-store's parsers, which already tolerate anything — an old
 * shape, another version's fields, garbage.
 *
 * Not here, on purpose: `outside:seen-alerts:*`, the notifier's record of
 * which warnings this device has already announced. It's about this device,
 * not this person, and syncing it would let one device's notification
 * silence another's.
 */

export const PREF_PREFIX = "outside";

export const PREF_KEYS = {
  // The map keeps the key every page used to share, so its settings carry over.
  filtersMap: `${PREF_PREFIX}:filters:v1`,
  filtersReports: `${PREF_PREFIX}:filters:reports:v1`,
  filtersAlerts: `${PREF_PREFIX}:filters:alerts:v1`,
  locations: `${PREF_PREFIX}:locations:v1`,
  notify: `${PREF_PREFIX}:notify:v1`,
  placeTab: `${PREF_PREFIX}:place-tab:v1`,
  placesView: `${PREF_PREFIX}:places-view:v1`,
  resortPrefs: `${PREF_PREFIX}:resort-prefs:v1`,
  theme: THEME_STORAGE_KEY,
} as const;

export const SYNCED_PREF_KEYS: readonly string[] = Object.values(PREF_KEYS);

/** Saved places with a long custom resort order fit comfortably; a runaway value doesn't. */
export const MAX_PREF_BYTES = 64 * 1024;

export function isSyncedPrefKey(key: unknown): key is string {
  return typeof key === "string" && SYNCED_PREF_KEYS.includes(key);
}

/** Stored values are JSON text, as localStorage holds them. */
export type PrefValues = Record<string, string>;

/**
 * Keeps only entries the server will store: a known key, and a value that is
 * JSON of a sane size. Anything else is dropped rather than refused, so one
 * bad value never costs the rest.
 */
export function cleanPrefValues(input: unknown): PrefValues {
  const out: PrefValues = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isSyncedPrefKey(key) || typeof value !== "string") continue;
    if (new TextEncoder().encode(value).length > MAX_PREF_BYTES) continue;
    try {
      JSON.parse(value);
    } catch {
      continue;
    }
    out[key] = value;
  }
  return out;
}
