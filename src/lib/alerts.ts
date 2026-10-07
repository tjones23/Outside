import { eventInfo, eventLevel } from "./alert-catalog";
import { centroid, distanceMeters, ringsContain, simplifyRing, withoutSpecks } from "./geo";
import { outerRings } from "./geojson";
import type { LatLng, Ring, StormAlert, StormCategory } from "./types";

/**
 * NWS active alerts. Ported from `NwsService.cs` and `StormAlert.cs`, then
 * widened from the four convective products to every alert NWS issues —
 * heat, flood, coastal, tropical, winter, fire, marine and the rest.
 *
 * Only storm-based warnings (tornado, severe thunderstorm, flash flood…) come
 * with a polygon. Everything issued by zone or county arrives without one, so
 * the server joins outlines on (see `parseWwaOutlines` and `withOutlines`).
 */

/**
 * Every actual (non-test, non-exercise) alert in effect. Updates are included:
 * an alert that's been extended or changed is reissued as an Update, and its
 * predecessor drops out of the active list.
 */
export const NWS_ALERTS_URL = "https://api.weather.gov/alerts/active?status=actual";

/**
 * NWS's map service of the same alerts, with zone-based ones already drawn as
 * polygons and simplified server-side (`maxAllowableOffset`, in degrees).
 * Joined to the NWS API alerts by CAP id. Refreshed upstream every 5 minutes.
 */
export const NWS_WWA_OUTLINES_URL =
  "https://mapservices.weather.noaa.gov/eventdriven/rest/services/WWA/watch_warn_adv/MapServer/1/query" +
  "?where=1%3D1&outFields=cap_id,prod_type&returnGeometry=true&f=geojson" +
  "&maxAllowableOffset=0.01&geometryPrecision=3&outSR=4326";

/** Tornado / wind / hail, for the convective products only. */
export function alertCategory(event: string): StormCategory | null {
  const e = event.toLowerCase();
  if (e.includes("tornado")) return "tornado";
  if (e.includes("hail")) return "hail";
  // Severe thunderstorm: wind- and hail-driven, shown with wind.
  if (e.includes("severe thunderstorm")) return "wind";
  return null;
}

export function alertColor(event: string): string {
  return eventInfo(event).color;
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

/** NWS GeoJSON FeatureCollection → alerts. Features without an event, and cancellations, are skipped. */
export function parseNwsAlerts(json: unknown): StormAlert[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];

  const out: StormAlert[] = [];
  const seen = new Set<string>();
  for (const f of features) {
    const props = (f as { properties?: unknown })?.properties;
    const event = str(props, "event");
    if (!event) continue;
    if (str(props, "messageType")?.toLowerCase() === "cancel") continue;

    const id = str(f, "id") ?? str(props, "id") ?? `${event}|${str(props, "sent") ?? ""}|${out.length}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const polygons = outerRings((f as { geometry?: unknown }).geometry);
    const info = eventInfo(event);
    const level = eventLevel(event);
    out.push({
      id,
      event,
      headline: str(props, "headline"),
      areaDesc: str(props, "areaDesc"),
      severity: str(props, "severity"),
      effective: str(props, "effective"),
      expires: str(props, "ends") ?? str(props, "expires"),
      senderName: str(props, "senderName"),
      description: str(props, "description"),
      instruction: str(props, "instruction"),
      polygons,
      stormBased: polygons.length > 0,
      category: alertCategory(event),
      group: info.group,
      level,
      priority: info.priority,
      isWarning: level === "warning",
      isWatch: level === "watch",
      severityRank: severityRank(str(props, "severity")),
      color: info.color,
      centroid: centroid(polygons[0]),
    });
  }
  return out;
}

/** The CAP identifier at the end of an alert's NWS URL — the key NWS's map service uses. */
export function capId(alertId: string): string {
  return alertId.slice(alertId.lastIndexOf("/") + 1);
}

/**
 * The zones and counties each alert covers, by alert id: NWS zone URLs such as
 * `https://api.weather.gov/zones/forecast/FLZ069`. Only needed on the server,
 * for alerts the map service has no outline for.
 */
export function parseAffectedZones(json: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    const id = str(f, "id");
    const zones = (f as { properties?: { affectedZones?: unknown } })?.properties?.affectedZones;
    if (!id || !Array.isArray(zones)) continue;
    out.set(
      id,
      zones.filter((z): z is string => typeof z === "string" && z.startsWith("https://api.weather.gov/zones/")),
    );
  }
  return out;
}

/** About 0.1 km²: smaller rings in an alert's outline are specks, not places. */
export const SPECK_AREA = 1e-5;

/** NWS map-service GeoJSON → outer rings by CAP id. Features without a CAP id are skipped. */
export function parseWwaOutlines(json: unknown): Map<string, Ring[]> {
  const out = new Map<string, Ring[]>();
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return out;
  for (const f of features) {
    const cap = str((f as { properties?: unknown })?.properties, "cap_id");
    if (!cap) continue;
    const rings = outerRings((f as { geometry?: unknown }).geometry).filter((r) => r.length >= 4);
    if (rings.length === 0) continue;
    const list = out.get(cap);
    if (list) list.push(...rings);
    else out.set(cap, rings);
  }
  for (const [cap, rings] of out) out.set(cap, withoutSpecks(rings, SPECK_AREA));
  return out;
}

/** Simplification for zone outlines fetched one by one from the NWS API, in degrees. */
export const ZONE_TOLERANCE = 0.01;

/** One NWS zone (GeoJSON Feature) → simplified outer rings. */
export function parseZoneOutline(json: unknown): Ring[] {
  const rings = outerRings((json as { geometry?: unknown })?.geometry)
    .map((ring) => simplifyRing(ring, ZONE_TOLERANCE))
    .filter((ring): ring is Ring => ring !== null);
  return withoutSpecks(rings, SPECK_AREA);
}

/**
 * Give every alert without a polygon of its own an outline: first from the
 * map service's join (`byCap`), else from its zones' outlines (`zonesOf` →
 * `byZone`). Alerts nothing is known about keep no polygons; they still list.
 */
export function withOutlines(
  alerts: StormAlert[],
  byCap: Map<string, Ring[]>,
  zonesOf: Map<string, string[]> = new Map(),
  byZone: Map<string, Ring[]> = new Map(),
): StormAlert[] {
  return alerts.map((alert) => {
    if (alert.polygons.length > 0) return alert;
    let rings = byCap.get(capId(alert.id));
    if (!rings) {
      const fromZones = (zonesOf.get(alert.id) ?? []).flatMap((z) => byZone.get(z) ?? []);
      rings = fromZones.length > 0 ? fromZones : undefined;
    }
    return rings ? { ...alert, polygons: rings, centroid: largestRingCentroid(rings) } : alert;
  });
}

/** Zone URLs still needed: those of alerts with no polygon and no map-service outline. */
export function zonesStillNeeded(
  alerts: StormAlert[],
  byCap: Map<string, Ring[]>,
  zonesOf: Map<string, string[]>,
): string[] {
  const needed = new Set<string>();
  for (const alert of alerts) {
    if (alert.polygons.length > 0 || byCap.has(capId(alert.id))) continue;
    for (const zone of zonesOf.get(alert.id) ?? []) needed.add(zone);
  }
  return [...needed].sort();
}

/** The centroid of the ring with the most vertices — a fair "where is it" for a multi-zone alert. */
function largestRingCentroid(rings: Ring[]): LatLng | null {
  let best: Ring | undefined;
  for (const ring of rings) if (!best || ring.length > best.length) best = ring;
  return centroid(best);
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
 * mode: newest first, most severe first (NWS priority breaking ties),
 * nearest first. Distance without a
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
        ? b.severityRank - a.severityRank || b.priority - a.priority || when(a) - when(b)
        : a.severityRank - b.severityRank || a.priority - b.priority || when(b) - when(a),
    );
  }

  if (sort === "distance" && here) {
    // An alert you're inside is as near as it gets, wherever its middle is.
    const key = (a: StormAlert) =>
      alertContains(a, here) ? 0 : a.centroid ? distanceMeters(here, a.centroid) : Infinity;
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

/** Most important first (NWS map priority), then newest. */
export function byPriority(a: StormAlert, b: StormAlert): number {
  return a.priority - b.priority || when(b) - when(a);
}
