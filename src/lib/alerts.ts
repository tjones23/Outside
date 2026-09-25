import { centroid, distanceMeters, ringsContain } from "./geo";
import { outerRings } from "./geojson";
import type { LatLng, StormAlert, StormCategory } from "./types";

/**
 * NWS active alerts. Ported from `NwsService.cs` and `StormAlert.cs`.
 *
 * Only the four products that matter for storm damage are requested; every
 * other alert type (flood, winter, heat…) is out of scope.
 */

export const ALERT_EVENTS = [
  "Tornado Warning",
  "Severe Thunderstorm Warning",
  "Tornado Watch",
  "Severe Thunderstorm Watch",
] as const;

export const NWS_ALERTS_URL =
  "https://api.weather.gov/alerts/active?status=actual&message_type=alert&event=" +
  encodeURIComponent(ALERT_EVENTS.join(","));

export function alertCategory(event: string): StormCategory {
  const e = event.toLowerCase();
  if (e.includes("tornado")) return "tornado";
  if (e.includes("hail")) return "hail";
  // Severe thunderstorm: wind- and hail-driven, shown with wind.
  return "wind";
}

export function alertColor(event: string): string {
  const e = event.toLowerCase();
  if (e.includes("tornado")) return "#FF0000";
  if (e.includes("severe thunderstorm")) return "#FFA500";
  return "#FFD700";
}

export function severityRank(severity: string | null): number {
  switch (severity?.toLowerCase()) {
    case "extreme":
      return 0;
    case "severe":
      return 1;
    case "moderate":
      return 2;
    case "minor":
      return 3;
    default:
      return 4;
  }
}

function str(obj: unknown, key: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : null;
}

/** NWS GeoJSON FeatureCollection → alerts. Features without an event are skipped. */
export function parseNwsAlerts(json: unknown): StormAlert[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];

  const out: StormAlert[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const props = (f as { properties?: unknown })?.properties;
    const event = str(props, "event");
    if (!event) continue;

    const id = str(f, "id") ?? str(props, "id") ?? `${event}|${str(props, "sent") ?? ""}|${out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const polygons = outerRings((f as { geometry?: unknown }).geometry);
    out.push({
      id,
      event,
      headline: str(props, "headline"),
      areaDesc: str(props, "areaDesc"),
      severity: str(props, "severity"),
      effective: str(props, "effective"),
      expires: str(props, "expires"),
      senderName: str(props, "senderName"),
      description: str(props, "description"),
      polygons,
      category: alertCategory(event),
      isWarning: /warning/i.test(event),
      isWatch: /watch/i.test(event),
      severityRank: severityRank(str(props, "severity")),
      color: alertColor(event),
      centroid: centroid(polygons[0]),
    });
  }
  return out;
}

export function alertContains(alert: StormAlert, point: LatLng): boolean {
  return ringsContain(alert.polygons, point);
}

export type AlertSort = "recent" | "severity" | "distance";

/** Newest issuance first is the natural reading order for alerts. */
function when(a: StormAlert): number {
  const t = Date.parse(a.effective ?? a.expires ?? "");
  return Number.isNaN(t) ? -Infinity : t;
}

/**
 * Sort the way the Alerts screen does (`StormDataService.Alerts`).
 *
 * The default direction (`ascending = false`) is the useful one for each
 * mode: newest first, most severe first, nearest first. Distance without a
 * location falls back to newest first.
 */
export function sortAlerts(
  alerts: StormAlert[],
  sort: AlertSort,
  ascending: boolean,
  here: LatLng | null,
): StormAlert[] {
  const list = [...alerts];

  if (sort === "severity") {
    return list.sort((a, b) =>
      ascending
        ? b.severityRank - a.severityRank || when(a) - when(b)
        : a.severityRank - b.severityRank || when(b) - when(a),
    );
  }

  if (sort === "distance" && here) {
    const key = (a: StormAlert) => (a.centroid ? distanceMeters(here, a.centroid) : Infinity);
    return list.sort((a, b) => {
      const d = key(a) - key(b);
      // Infinity − Infinity is NaN; treat two unplaceable alerts as equal.
      const diff = Number.isNaN(d) ? 0 : d;
      return ascending ? -diff : diff;
    });
  }

  if (sort === "distance") return list.sort((a, b) => when(b) - when(a));

  return list.sort((a, b) => (ascending ? when(a) - when(b) : when(b) - when(a)));
}
