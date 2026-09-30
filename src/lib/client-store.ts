"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_FILTERS, normalizeFilters, CATEGORY_KEY } from "./filters";
import { newId } from "./id";
import { DEFAULT_THEME_PREFERENCE, parseThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "./theme";
import type { FilterSettings, NotificationSettings, SavedLocation, StormCategory } from "./types";

/**
 * Everything personal lives here, in this browser — never on the server.
 *
 * Filters, saved places, notification settings and the theme are
 * per-browser by design: there are no accounts, and the server holds nothing
 * but cached public weather data. The pattern is WhatsGood's:
 * `useSyncExternalStore` over localStorage, which gives a correct server
 * snapshot for free and keeps tabs in sync through the `storage` event.
 *
 * Every access is wrapped: localStorage throws in private-browsing modes and
 * when site data is blocked, and a preference is never worth breaking a page.
 */

const PREFIX = "outside";
const FILTERS_KEY = `${PREFIX}:filters:v1`;
const LOCATIONS_KEY = `${PREFIX}:locations:v1`;
const NOTIFY_KEY = `${PREFIX}:notify:v1`;
const SEEN_ALERTS_KEY = `${PREFIX}:seen-alerts:v1`;

const DEFAULT_NOTIFY: NotificationSettings = { savedLocationAlerts: false, anyWarningAlerts: false };
const EMPTY_LOCATIONS: SavedLocation[] = [];

/** Last parsed value per key, reused while the stored string is unchanged. */
const snapshots = new Map<string, { raw: string | null; value: unknown }>();

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Parse once per distinct stored string. `useSyncExternalStore` compares by
 * identity, so returning a freshly parsed object on every read would loop.
 */
function readSnapshot<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  const raw = readRaw(key);
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw) return cached.value as T;

  let value = fallback;
  if (raw) {
    try {
      value = parse(JSON.parse(raw));
    } catch {
      value = fallback;
    }
  }
  snapshots.set(key, { raw, value });
  return value;
}

const subscribers = new Map<string, (onChange: () => void) => () => void>();

function subscriberFor(key: string) {
  let existing = subscribers.get(key);
  if (existing) return existing;
  existing = (onChange: () => void) => {
    window.addEventListener(`${PREFIX}:${key}`, onChange);
    // Fires only for *other* tabs, which is why we dispatch our own event too.
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(`${PREFIX}:${key}`, onChange);
      window.removeEventListener("storage", onChange);
    };
  };
  subscribers.set(key, existing);
  return existing;
}

function persist(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage blocked; nothing more to do.
  }
  snapshots.delete(key);
  window.dispatchEvent(new Event(`${PREFIX}:${key}`));
}

function useStored<T>(key: string, parse: (value: unknown) => T, fallback: T): T {
  return useSyncExternalStore(
    subscriberFor(key),
    () => readSnapshot(key, parse, fallback),
    () => fallback,
  );
}

/** True once the client has taken over from server-rendered markup. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

// --- Filters ---------------------------------------------------------------

function readFilters(): FilterSettings {
  return readSnapshot(FILTERS_KEY, normalizeFilters, DEFAULT_FILTERS);
}

export function useFilters() {
  const filters = useStored(FILTERS_KEY, normalizeFilters, DEFAULT_FILTERS);

  // Read the latest stored value rather than closing over `filters`, so two
  // quick changes in one event can't overwrite each other.
  const update = useCallback((patch: Partial<FilterSettings>) => {
    persist(FILTERS_KEY, normalizeFilters({ ...readFilters(), ...patch }));
  }, []);

  const toggleCategory = useCallback((category: StormCategory) => {
    const key = CATEGORY_KEY[category];
    const current = readFilters();
    persist(FILTERS_KEY, { ...current, [key]: !current[key] });
  }, []);

  const reset = useCallback(() => persist(FILTERS_KEY, DEFAULT_FILTERS), []);

  return { filters, update, toggleCategory, reset };
}

// --- Saved locations --------------------------------------------------------

function parseLocations(value: unknown): SavedLocation[] {
  if (!Array.isArray(value)) return EMPTY_LOCATIONS;
  return value.flatMap((item): SavedLocation[] => {
    const r = item as Record<string, unknown>;
    if (typeof r?.id !== "string" || typeof r.name !== "string") return [];
    if (typeof r.lat !== "number" || typeof r.lon !== "number") return [];
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return [];
    return [
      {
        id: r.id,
        name: r.name,
        lat: r.lat,
        lon: r.lon,
        addedAt: typeof r.addedAt === "number" ? r.addedAt : 0,
      },
    ];
  });
}

function readLocations(): SavedLocation[] {
  return readSnapshot(LOCATIONS_KEY, parseLocations, EMPTY_LOCATIONS);
}

export function useSavedLocations() {
  const locations = useStored(LOCATIONS_KEY, parseLocations, EMPTY_LOCATIONS);

  const add = useCallback((name: string, lat: number, lon: number): SavedLocation => {
    const location: SavedLocation = {
      id: newId(),
      name: name.trim() || "Saved place",
      lat,
      lon,
      addedAt: Date.now(),
    };
    persist(LOCATIONS_KEY, [...readLocations(), location]);
    return location;
  }, []);

  const remove = useCallback((id: string) => {
    persist(
      LOCATIONS_KEY,
      readLocations().filter((l) => l.id !== id),
    );
  }, []);

  const rename = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    persist(
      LOCATIONS_KEY,
      readLocations().map((l) => (l.id === id ? { ...l, name: trimmed } : l)),
    );
  }, []);

  return { locations, add, remove, rename };
}

// --- Notification settings --------------------------------------------------

function parseNotify(value: unknown): NotificationSettings {
  const r = (value ?? {}) as Record<string, unknown>;
  return {
    savedLocationAlerts: r.savedLocationAlerts === true,
    anyWarningAlerts: r.anyWarningAlerts === true,
  };
}

export function useNotificationSettings() {
  const settings = useStored(NOTIFY_KEY, parseNotify, DEFAULT_NOTIFY);
  const update = useCallback((patch: Partial<NotificationSettings>) => {
    persist(NOTIFY_KEY, {
      ...readSnapshot(NOTIFY_KEY, parseNotify, DEFAULT_NOTIFY),
      ...patch,
    });
  }, []);
  return { settings, update };
}

// --- Appearance ------------------------------------------------------------

export function readThemePreference(): ThemePreference {
  return readSnapshot(THEME_STORAGE_KEY, parseThemePreference, DEFAULT_THEME_PREFERENCE);
}

export function subscribeThemePreference(onChange: () => void): () => void {
  return subscriberFor(THEME_STORAGE_KEY)(onChange);
}

export function useThemePreference() {
  const preference = useStored(THEME_STORAGE_KEY, parseThemePreference, DEFAULT_THEME_PREFERENCE);
  const setPreference = useCallback((next: ThemePreference) => persist(THEME_STORAGE_KEY, next), []);
  return { preference, setPreference };
}

// --- Seen alerts (not reactive; only the notifier reads it) ------------------

/** null until a baseline has been recorded in this browser. */
export function readSeenAlerts(): string[] | null {
  const raw = readRaw(SEEN_ALERTS_KEY);
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}

export function writeSeenAlerts(ids: string[]): void {
  try {
    window.localStorage.setItem(SEEN_ALERTS_KEY, JSON.stringify(ids));
  } catch {
    // Without storage every visit re-baselines, which is the safe failure.
  }
}
