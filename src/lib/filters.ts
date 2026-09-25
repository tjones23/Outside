import { clampDay, isOutlookKind, outlookProduct } from "./outlook";
import type { FilterSettings, OutlookProduct, StormAlert, StormCategory, StormReport } from "./types";

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
    outlookDay: kind ? clampDay(kind, day) : clamp(day, 1, 3),
    showRadar: bool("showRadar"),
    radarOpacity: clamp(num("radarOpacity") ?? DEFAULT_FILTERS.radarOpacity, 0.1, 1),
  };
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

/** Category enabled, and warning/watch kind enabled. */
export function passesAlert(filters: FilterSettings, alert: StormAlert): boolean {
  return (
    isEnabled(filters, alert.category) && (alert.isWatch ? filters.showWatches : filters.showWarnings)
  );
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
