import { ALERT_GROUPS } from "./alert-catalog";
import { isForecastProduct } from "./forecast";
import { clampDay, isOutlookKind, outlookProduct } from "./outlook";
import type { AlertGroup, FilterSettings, OutlookProduct, StormAlert, StormCategory, StormReport } from "./types";

/**
 * What the map and lists show. Ported from `FilterSettings.cs`.
 *
 * Filters are per-browser and applied client-side, so the server's cached
 * feeds never depend on anyone's settings.
 */

export const DEFAULT_FILTERS: FilterSettings = {
  showTornado: true,
  showWind: true,
  showHail: true,
  showWarnings: true,
  showWatches: true,
  minWindMph: 0,
  minHailInches: 0,
  minTornadoRating: null,
  reportDays: 3,
  outlookKind: null,
  outlookDay: 1,
  showRadar: false,
  radarOpacity: 0.65,
  // Marine alerts blanket every coastline in small-craft advisories; they're
  // one tap away, but off until asked for.
  alertGroups: ALERT_GROUPS.filter((g) => g !== "marine"),
  showAdvisories: true,
  showStatements: false,
  showTropical: true,
  forecastProduct: null,
};

/** Same options as the mobile filter screen. */
export const REPORT_DAY_OPTIONS = [1, 2, 3, 5] as const;
export const WIND_MIN = 60;
export const WIND_MAX = 80;
export const HAIL_MAX = 4;
export const HAIL_STEP = 0.25;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Anything → valid settings.
 *
 * Stored settings come from localStorage, which may hold an older shape, a
 * hand edit or garbage. Missing or wrong-typed fields fall back to defaults;
 * numbers are clamped to the ranges the UI offers.
 */
export function normalizeFilters(input: unknown): FilterSettings {
  const src = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const bool = (key: keyof FilterSettings) =>
    typeof src[key] === "boolean" ? (src[key] as boolean) : (DEFAULT_FILTERS[key] as boolean);
  const num = (key: keyof FilterSettings) =>
    typeof src[key] === "number" && Number.isFinite(src[key]) ? (src[key] as number) : null;

  const rating = num("minTornadoRating");
  const kind = isOutlookKind(src.outlookKind) ? src.outlookKind : null;
  const day = Math.round(num("outlookDay") ?? DEFAULT_FILTERS.outlookDay);
  // Kept in the catalog's order, so equal settings serialize equally.
  const groups = Array.isArray(src.alertGroups)
    ? ALERT_GROUPS.filter((g) => (src.alertGroups as unknown[]).includes(g))
    : DEFAULT_FILTERS.alertGroups;
  const forecast = isForecastProduct(src.forecastProduct) ? src.forecastProduct : null;
  // Radar and a forecast animation share the map's imagery slot.
  const showRadar = bool("showRadar") && forecast === null;

  return {
    showTornado: bool("showTornado"),
    showWind: bool("showWind"),
    showHail: bool("showHail"),
    showWarnings: bool("showWarnings"),
    showWatches: bool("showWatches"),
    minWindMph: clamp(Math.round(num("minWindMph") ?? 0), 0, WIND_MAX),
    minHailInches: clamp(num("minHailInches") ?? 0, 0, HAIL_MAX),
    minTornadoRating: rating === null ? null : clamp(Math.round(rating), 0, 5),
    reportDays: clamp(Math.round(num("reportDays") ?? DEFAULT_FILTERS.reportDays), 1, 5),
    outlookKind: kind,
    outlookDay: kind ? clampDay(kind, day) : clamp(day, 1, 5),
    showRadar,
    radarOpacity: clamp(num("radarOpacity") ?? DEFAULT_FILTERS.radarOpacity, 0.1, 1),
    alertGroups: groups,
    showAdvisories: bool("showAdvisories"),
    showStatements: bool("showStatements"),
    showTropical: bool("showTropical"),
    forecastProduct: forecast,
  };
}

export function isGroupEnabled(filters: FilterSettings, group: AlertGroup): boolean {
  return filters.alertGroups.includes(group);
}

export function isEnabled(filters: FilterSettings, category: StormCategory): boolean {
  switch (category) {
    case "tornado":
      return filters.showTornado;
    case "wind":
      return filters.showWind;
    case "hail":
      return filters.showHail;
  }
}

export const CATEGORY_KEY: Record<StormCategory, "showTornado" | "showWind" | "showHail"> = {
  tornado: "showTornado",
  wind: "showWind",
  hail: "showHail",
};

/**
 * Its hazard family is on, its tier (warning / watch / advisory / statement)
 * is on, and — for the convective products — its tornado / wind / hail
 * category is on.
 */
export function passesAlert(filters: FilterSettings, alert: StormAlert): boolean {
  if (!isGroupEnabled(filters, alert.group)) return false;
  if (alert.category && !isEnabled(filters, alert.category)) return false;
  switch (alert.level) {
    case "warning":
      return filters.showWarnings;
    case "watch":
      return filters.showWatches;
    case "advisory":
      return filters.showAdvisories;
    case "statement":
      return filters.showStatements;
  }
}

/**
 * Category enabled, and the magnitude clears the minimum.
 *
 * A minimum of 0 / null means "no minimum" and keeps unrated reports. Once a
 * minimum is set, a report whose magnitude can't be read is excluded — an
 * "UNK" wind report can't be shown to clear 70 mph.
 */
export function passesReport(filters: FilterSettings, report: StormReport): boolean {
  if (!isEnabled(filters, report.category)) return false;
  switch (report.category) {
    case "wind":
      return filters.minWindMph <= 0 || (report.windMph !== null && report.windMph >= filters.minWindMph);
    case "hail":
      return (
        filters.minHailInches <= 0 ||
        (report.hailInches !== null && report.hailInches >= filters.minHailInches)
      );
    case "tornado":
      return (
        filters.minTornadoRating === null ||
        (report.efRating !== null && report.efRating >= filters.minTornadoRating)
      );
  }
}

/** The outlook product to draw, day clamped to one the kind publishes. */
export function selectedOutlook(filters: FilterSettings): OutlookProduct | null {
  if (!filters.outlookKind) return null;
  return outlookProduct(clampDay(filters.outlookKind, filters.outlookDay), filters.outlookKind);
}
