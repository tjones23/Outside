"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_FILTERS, normalizeAlertsFilters, normalizeFilters, CATEGORY_KEY, type FilterScope } from "./filters";
import { newId } from "./id";
import { SKI_PASSES, type ResortSort, type SkiPass } from "./resorts";
import { DEFAULT_THEME_PREFERENCE, parseThemePreference, THEME_STORAGE_KEY, type ThemePreference } from "./theme";
import type { AlertGroup, FilterSettings, NotificationSettings, SavedLocation, StormCategory } from "./types";

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
// The map keeps the key every page used to share, so its settings carry over.
const FILTERS_KEYS: Record<FilterScope, string> = {
  map: `${PREFIX}:filters:v1`,
  reports: `${PREFIX}:filters:reports:v1`,
  alerts: `${PREFIX}:filters:alerts:v1`,
};
const LOCATIONS_KEY = `${PREFIX}:locations:v1`;
const NOTIFY_KEY = `${PREFIX}:notify:v1`;
const PLACE_TAB_KEY = `${PREFIX}:place-tab:v1`;
const PLACES_VIEW_KEY = `${PREFIX}:places-view:v1`;
const RESORT_PREFS_KEY = `${PREFIX}:resort-prefs:v1`;
// v2: every NWS warning, not just tornado and severe thunderstorm. A new key
// re-records the baseline, so the heat, flood and coastal warnings already in
// effect the first time this version runs don't all notify at once.
const SEEN_ALERTS_KEY = `${PREFIX}:seen-alerts:v2`;

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

// The alerts page starts from the set every page used to share, so the hazards
// chosen there survive the split. The reports page starts from the defaults:
// the shared set's storm types were as often switched off for the map's sake.
if (typeof window !== "undefined" && readRaw(FILTERS_KEYS.alerts) === null) {
  const shared = readRaw(FILTERS_KEYS.map);
  if (shared !== null) {
    try {
      window.localStorage.setItem(FILTERS_KEYS.alerts, shared);
    } catch {
      // Storage blocked; the alerts page falls back to the defaults.
    }
  }
}

function readFilters(key: string): FilterSettings {
  return readSnapshot(key, normalizeFilters, DEFAULT_FILTERS);
}

/** One page's filters — see `FILTER_SCOPES`. */
export function useFilters(scope: FilterScope) {
  const key = FILTERS_KEYS[scope];
  const filters = useStored(key, scope === "alerts" ? normalizeAlertsFilters : normalizeFilters, DEFAULT_FILTERS);

  // Read the latest stored value rather than closing over `filters`, so two
  // quick changes in one event can't overwrite each other.
  const update = useCallback(
    (patch: Partial<FilterSettings>) => {
      persist(key, normalizeFilters({ ...readFilters(key), ...patch }));
    },
    [key],
  );

  const toggleCategory = useCallback(
    (category: StormCategory) => {
      const field = CATEGORY_KEY[category];
      const current = readFilters(key);
      persist(key, { ...current, [field]: !current[field] });
    },
    [key],
  );

  const toggleAlertGroup = useCallback(
    (group: AlertGroup) => {
      const current = readFilters(key);
      const on = current.alertGroups.includes(group);
      persist(
        key,
        normalizeFilters({
          ...current,
          alertGroups: on ? current.alertGroups.filter((g) => g !== group) : [...current.alertGroups, group],
        }),
      );
    },
    [key],
  );

  const reset = useCallback(() => persist(key, DEFAULT_FILTERS), [key]);

  return { filters, update, toggleCategory, toggleAlertGroup, reset };
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
        ...(typeof r.resortId === "string" ? { resortId: r.resortId } : {}),
      },
    ];
  });
}

function readLocations(): SavedLocation[] {
  return readSnapshot(LOCATIONS_KEY, parseLocations, EMPTY_LOCATIONS);
}

export function useSavedLocations() {
  const locations = useStored(LOCATIONS_KEY, parseLocations, EMPTY_LOCATIONS);

  const add = useCallback((name: string, lat: number, lon: number, resortId?: string): SavedLocation => {
    const location: SavedLocation = {
      id: newId(),
      name: name.trim() || "Saved place",
      lat,
      lon,
      addedAt: Date.now(),
      ...(resortId ? { resortId } : {}),
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

  /** One place up or down the list. */
  const move = useCallback((id: string, delta: -1 | 1) => {
    const list = readLocations();
    const i = list.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    persist(LOCATIONS_KEY, next);
  }, []);

  /** Point favorites at their resort's new id (saved place id → resort id). */
  const relink = useCallback((moves: Map<string, string>) => {
    persist(
      LOCATIONS_KEY,
      readLocations().map((l) => (moves.has(l.id) ? { ...l, resortId: moves.get(l.id)! } : l)),
    );
  }, []);

  return { locations, add, remove, rename, move, relink };
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

// --- Place sheet tab ----------------------------------------------------------

export const PLACE_TABS = ["forecast", "snow", "reports"] as const;
export type PlaceTab = (typeof PLACE_TABS)[number];

function parsePlaceTab(value: unknown): PlaceTab {
  return PLACE_TABS.includes(value as PlaceTab) ? (value as PlaceTab) : "forecast";
}

/** The tab a place opens on: the last one chosen, so a skier lands on snow every time. */
export function usePlaceTab() {
  const tab = useStored(PLACE_TAB_KEY, parsePlaceTab, "forecast");
  const setTab = useCallback((next: PlaceTab) => persist(PLACE_TAB_KEY, next), []);
  return { tab, setTab };
}

// --- Places page ---------------------------------------------------------------

export const PLACES_VIEWS = ["favorites", "resorts"] as const;
export type PlacesView = (typeof PLACES_VIEWS)[number];

function parsePlacesView(value: unknown): PlacesView {
  return PLACES_VIEWS.includes(value as PlacesView) ? (value as PlacesView) : "favorites";
}

/** Favorites or ski resorts: the last one looked at. */
export function usePlacesView() {
  const view = useStored(PLACES_VIEW_KEY, parsePlacesView, "favorites");
  const setView = useCallback((next: PlacesView) => persist(PLACES_VIEW_KEY, next), []);
  return { view, setView };
}

export interface ResortPrefs {
  /** A state picked by hand; null follows the viewer's location. */
  state: string | null;
  sort: ResortSort;
  /** Empty shows every pass. */
  passes: SkiPass[];
  /** Custom order per state, resort ids. */
  order: Record<string, string[]>;
}

const DEFAULT_RESORT_PREFS: ResortPrefs = { state: null, sort: "distance", passes: [], order: {} };

function parseResortPrefs(value: unknown): ResortPrefs {
  const r = (value ?? {}) as Record<string, unknown>;
  const order: Record<string, string[]> = {};
  if (r.order && typeof r.order === "object") {
    for (const [state, ids] of Object.entries(r.order as Record<string, unknown>)) {
      if (/^[A-Z]{2}$/.test(state) && Array.isArray(ids)) order[state] = ids.filter((id): id is string => typeof id === "string");
    }
  }
  return {
    state: typeof r.state === "string" && /^[A-Z]{2}$/.test(r.state) ? r.state : null,
    sort: r.sort === "custom" ? "custom" : "distance",
    passes: Array.isArray(r.passes) ? SKI_PASSES.filter((p) => (r.passes as unknown[]).includes(p)) : [],
    order,
  };
}

export function useResortPrefs() {
  const prefs = useStored(RESORT_PREFS_KEY, parseResortPrefs, DEFAULT_RESORT_PREFS);
  const update = useCallback((patch: Partial<ResortPrefs>) => {
    persist(RESORT_PREFS_KEY, { ...readSnapshot(RESORT_PREFS_KEY, parseResortPrefs, DEFAULT_RESORT_PREFS), ...patch });
  }, []);
  const setOrder = useCallback((state: string, ids: string[]) => {
    const current = readSnapshot(RESORT_PREFS_KEY, parseResortPrefs, DEFAULT_RESORT_PREFS);
    persist(RESORT_PREFS_KEY, { ...current, order: { ...current.order, [state]: ids } });
  }, []);
  return { prefs, update, setOrder };
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
