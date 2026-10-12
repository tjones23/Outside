import { outerRings } from "./geojson";
import { withoutSpecks } from "./geo";
import type { Hotspot, HotspotConfidence, LatLng, WildfireIncident, WildfirePerimeter } from "./types";

/**
 * Wildfires: incidents and perimeters from NIFC's WFIGS (Wildland Fire
 * Interagency Geospatial Services), and satellite hotspots from NASA's VIIRS
 * instruments via Esri's Living Atlas. All three are public ArcGIS feature
 * services, queryable as GeoJSON with no key.
 *
 * WFIGS is the interagency record every federal and state agency reports
 * to (through IRWIN); its "current" layers hold wildfires that aren't
 * declared out yet. Incidents and perimeters share an IRWIN id, which is how
 * a perimeter finds its fire.
 */

const WFIGS = "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services";
export const WFIGS_INCIDENTS_URL = `${WFIGS}/WFIGS_Incident_Locations_Current/FeatureServer/0/query`;
export const WFIGS_PERIMETERS_URL = `${WFIGS}/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query`;
export const VIIRS_URL =
  "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Satellite_VIIRS_Thermal_Hotspots_and_Fire_Activity/FeatureServer/0/query";

export const WILDFIRE_ATTRIBUTION = "NIFC WFIGS";
export const HOTSPOT_ATTRIBUTION = "NASA FIRMS VIIRS via Esri Living Atlas";

const INCIDENT_FIELDS = [
  "IrwinID",
  "IncidentName",
  "IncidentSize",
  "PercentContained",
  "FireDiscoveryDateTime",
  "ModifiedOnDateTime_dt",
  "FireCause",
  "FireBehaviorGeneral",
  "IncidentShortDescription",
  "POOState",
  "POOCounty",
  "POOProtectingAgency",
  "TotalIncidentPersonnel",
  "UniqueFireIdentifier",
];

const PERIMETER_FIELDS = ["poly_IRWINID", "poly_IncidentName", "poly_GISAcres", "poly_PolygonDateTime"];

const HOTSPOT_FIELDS = ["frp", "confidence", "acq_time", "satellite"];

/** Hotspots older than this are left out: a day is enough to see what's burning now. */
export const HOTSPOT_MAX_HOURS = 24;

/**
 * Hotspots are fetched for North America north of central Mexico — the US
 * with Alaska and Hawaii, plus the Canadian fires whose smoke reaches it.
 * The whole world is over a million detections a week.
 */
const HOTSPOT_BOUNDS = "-170,18,-60,72";

/**
 * Perimeters are simplified by the service to about 100 m, which is finer
 * than a fire line is drawn at any zoom Outside is used at.
 */
const PERIMETER_OFFSET_DEG = 0.001;

/**
 * Fire perimeters come in hundreds of pieces — spot fires, unburned islands
 * cut out as separate parts — most of them a few acres. Pieces under about
 * two acres are dropped; each would cost the map an SVG path.
 */
const PERIMETER_SPECK_SQ_DEG = 1e-6;

/** ArcGIS caps each answer; ask for this many at a time and page through. */
export const ARCGIS_PAGE_SIZE = 2000;

function query(base: string, params: Record<string, string>): string {
  const search = new URLSearchParams({ outSR: "4326", f: "geojson", ...params });
  return `${base}?${search}`;
}

/** Page `offset` of active wildfires (prescribed burns are left out). */
export function incidentsUrl(offset = 0): string {
  return query(WFIGS_INCIDENTS_URL, {
    where: "IncidentTypeCategory='WF'",
    outFields: INCIDENT_FIELDS.join(","),
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
  });
}

export function perimetersUrl(offset = 0): string {
  return query(WFIGS_PERIMETERS_URL, {
    where: "attr_IncidentTypeCategory='WF'",
    outFields: PERIMETER_FIELDS.join(","),
    maxAllowableOffset: String(PERIMETER_OFFSET_DEG),
    geometryPrecision: "4",
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
  });
}

export function hotspotsUrl(offset = 0): string {
  return query(VIIRS_URL, {
    where: `hours_old<=${HOTSPOT_MAX_HOURS}`,
    geometry: HOTSPOT_BOUNDS,
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: HOTSPOT_FIELDS.join(","),
    geometryPrecision: "4",
    orderByFields: "OBJECTID",
    resultOffset: String(offset),
    resultRecordCount: String(ARCGIS_PAGE_SIZE),
  });
}

// --- Parsing ------------------------------------------------------------------

type Props = Record<string, unknown>;

interface Feature {
  props: Props;
  geometry: unknown;
}

/** A GeoJSON page from an ArcGIS query: its features, and whether more are waiting. */
export function parsePage(json: unknown): { features: Feature[]; more: boolean } {
  const j = (json ?? {}) as { features?: unknown; properties?: { exceededTransferLimit?: unknown }; error?: unknown };
  // ArcGIS answers 200 with an error body for a bad query.
  if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error).slice(0, 200)}`);
  if (!Array.isArray(j.features)) throw new Error("ArcGIS answer has no features list");
  return {
    features: j.features.map((f) => ({
      props: ((f as { properties?: unknown })?.properties ?? {}) as Props,
      geometry: (f as { geometry?: unknown })?.geometry,
    })),
    more: j.properties?.exceededTransferLimit === true,
  };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** ArcGIS dates are Unix ms. */
function iso(v: unknown): string | null {
  const ms = num(v);
  return ms === null ? null : new Date(ms).toISOString();
}

/** "{C2664A2A-…}" → "c2664a2a-…", so incidents and perimeters join however each writes it. */
export function irwinId(v: unknown): string | null {
  const s = text(v);
  return s ? s.replace(/[{}]/g, "").toLowerCase() : null;
}

function point(geometry: unknown): LatLng | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (g?.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates as unknown[];
  return typeof lat === "number" && typeof lon === "number" ? [lat, lon] : null;
}

/** "US-CA" → "CA". */
function state(v: unknown): string | null {
  const s = text(v);
  return s ? s.replace(/^US-/, "") : null;
}

/**
 * "Sacaton" → "Sacaton Fire". Names are kept as WFIGS writes them — some are
 * dispatch codes ("MTZ/INYO/88A") that any recasing would mangle.
 */
export function fireName(raw: unknown): string {
  const name = text(raw) ?? "Unnamed";
  return /\b(fire|complex)\b/i.test(name) ? name : `${name} Fire`;
}

export function parseIncidents(features: Feature[]): WildfireIncident[] {
  return features.flatMap(({ props, geometry }): WildfireIncident[] => {
    const coord = point(geometry);
    const id = irwinId(props.IrwinID);
    if (!coord || !id) return [];
    const contained = num(props.PercentContained);
    return [
      {
        id,
        name: fireName(props.IncidentName),
        coord,
        acres: num(props.IncidentSize),
        contained: contained === null ? null : Math.max(0, Math.min(100, contained)),
        discovered: iso(props.FireDiscoveryDateTime),
        updated: iso(props.ModifiedOnDateTime_dt),
        cause: text(props.FireCause),
        behavior: text(props.FireBehaviorGeneral),
        location: text(props.IncidentShortDescription),
        county: text(props.POOCounty),
        state: state(props.POOState),
        agency: text(props.POOProtectingAgency),
        personnel: num(props.TotalIncidentPersonnel),
        fireId: text(props.UniqueFireIdentifier),
      },
    ];
  });
}

export function parsePerimeters(features: Feature[]): WildfirePerimeter[] {
  return features.flatMap(({ props, geometry }): WildfirePerimeter[] => {
    const id = irwinId(props.poly_IRWINID);
    const rings = withoutSpecks(outerRings(geometry), PERIMETER_SPECK_SQ_DEG);
    if (!id || rings.length === 0) return [];
    return [
      {
        id,
        name: fireName(props.poly_IncidentName),
        rings,
        acres: num(props.poly_GISAcres),
        mapped: iso(props.poly_PolygonDateTime),
      },
    ];
  });
}

const CONFIDENCE: Record<string, HotspotConfidence> = { low: "low", nominal: "nominal", high: "high" };

export function parseHotspots(features: Feature[]): Hotspot[] {
  return features.flatMap(({ props, geometry }): Hotspot[] => {
    const coord = point(geometry);
    const time = num(props.acq_time);
    if (!coord || time === null) return [];
    return [
      {
        coord,
        time,
        frp: num(props.frp),
        confidence: CONFIDENCE[text(props.confidence)?.toLowerCase() ?? ""] ?? "nominal",
        satellite: text(props.satellite) ?? "",
      },
    ];
  });
}

// --- Display ------------------------------------------------------------------

/**
 * Containment, in Watch Duty's bands. A fire with no containment reported is
 * almost always a new start, so it's drawn with the active fires.
 */
export type ContainmentBand = "active" | "half" | "most" | "contained";

export function containmentBand(contained: number | null): ContainmentBand {
  if (contained === null || contained < 50) return "active";
  if (contained < 75) return "half";
  if (contained < 100) return "most";
  return "contained";
}

export const CONTAINMENT_BANDS: { band: ContainmentBand; label: string; color: string }[] = [
  { band: "active", label: "Under 50% contained", color: "#FF453A" },
  { band: "half", label: "50–74% contained", color: "#FF9F0A" },
  { band: "most", label: "75–99% contained", color: "#FFD60A" },
  { band: "contained", label: "Contained", color: "#9A9AA6" },
];

export function containmentColor(contained: number | null): string {
  const band = containmentBand(contained);
  return CONTAINMENT_BANDS.find((b) => b.band === band)!.color;
}

export function containmentText(contained: number | null): string {
  return contained === null ? "Containment not reported" : `${Math.round(contained)}% contained`;
}

/**
 * Marker diameter in pixels: a spot fire is a dot, a 100,000-acre fire a
 * bigger one — never so big that the West disappears under them zoomed out.
 */
export function fireMarkerSize(acres: number | null): number {
  const a = acres ?? 0;
  return Math.round(8 + Math.min(12, Math.log10(a + 1) * 2.4));
}

export function formatAcres(acres: number | null): string {
  if (acres === null) return "Size not reported";
  if (acres < 1) return "Under 1 acre";
  return `${Math.round(acres).toLocaleString("en-US")} acre${Math.round(acres) === 1 ? "" : "s"}`;
}

/** Hotspots by age: what's burning now stands out from this morning's pass. */
export const HOTSPOT_AGES: { hours: number; label: string; color: string }[] = [
  { hours: 6, label: "Last 6 hours", color: "#FF3B30" },
  { hours: 12, label: "6–12 hours ago", color: "#FF9500" },
  { hours: HOTSPOT_MAX_HOURS, label: "12–24 hours ago", color: "#FFCC00" },
];

export function hotspotColor(time: number, now: number): string {
  const hours = (now - time) / 3_600_000;
  return (HOTSPOT_AGES.find((a) => hours <= a.hours) ?? HOTSPOT_AGES[HOTSPOT_AGES.length - 1]).color;
}

const SATELLITES: Record<string, string> = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21" };

export function satelliteName(code: string): string {
  return SATELLITES[code] ?? (code || "VIIRS");
}
