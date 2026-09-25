import { alertContains } from "./alerts";
import { distanceMiles } from "./geo";
import type { LatLng, SavedLocation, StormAlert, StormReport } from "./types";

/** "Near me" logic, ported from `AppState.cs` and `SavedLocationsViewModel.cs`. */

export const NEARBY_RADIUS_MILES = 50;

/** Distance chips on the Reports screen; null = everywhere. */
export const REPORT_RADIUS_OPTIONS = [null, 50, 100, 250] as const;

/** Warnings (never watches) whose polygon covers the point. */
export function warningsContaining(alerts: StormAlert[], point: LatLng): StormAlert[] {
  return alerts.filter((a) => a.isWarning && alertContains(a, point));
}

export interface NearbyReport {
  report: StormReport;
  miles: number;
}

/** Reports within `radius` miles (inclusive), nearest first. */
export function reportsWithin(reports: StormReport[], point: LatLng, radius: number): NearbyReport[] {
  return reports
    .map((report) => ({ report, miles: distanceMiles(point, report.coord) }))
    .filter((r) => r.miles <= radius)
    .sort((a, b) => a.miles - b.miles);
}

export function reportsNear(reports: StormReport[], point: LatLng): NearbyReport[] {
  return reportsWithin(reports, point, NEARBY_RADIUS_MILES);
}

export type StatusTone = "alert" | "reports" | "quiet";

export interface LocationStatus {
  label: string;
  tone: StatusTone;
  /** The warning's color when tone is "alert". */
  color: string | null;
}

/**
 * One line summarizing a saved location: the first warning covering it, else
 * how many reports fell within 50 mi, else quiet.
 */
export function savedLocationStatus(
  location: SavedLocation,
  alerts: StormAlert[],
  reports: StormReport[],
): LocationStatus {
  const point: LatLng = [location.lat, location.lon];
  const warnings = warningsContaining(alerts, point);
  if (warnings.length > 0) {
    return { label: warnings[0].event, tone: "alert", color: warnings[0].color };
  }
  const n = reportsNear(reports, point).length;
  if (n === 0) return { label: "No nearby reports", tone: "quiet", color: null };
  return {
    label: `${n} report${n === 1 ? "" : "s"} within ${NEARBY_RADIUS_MILES} mi`,
    tone: "reports",
    color: null,
  };
}
