/**
 * The vocabulary Outside speaks.
 *
 * Every upstream payload (NWS GeoJSON, SPC CSV and GeoJSON, RainViewer JSON,
 * Nominatim JSON) is parsed into these shapes in `src/lib/`, and nothing in
 * `src/app` or `src/components` ever sees a raw one. They are also the wire
 * format of the `/api/*` routes, so everything here must stay plain JSON.
 *
 * Coordinates are `[lat, lon]` tuples throughout — the order Leaflet takes —
 * and GeoJSON's `[lon, lat]` is swapped exactly once, in `geojson.ts`.
 */

export type LatLng = [lat: number, lon: number];
export type Ring = LatLng[];

export type StormCategory = "tornado" | "wind" | "hail";

/** An active NWS warning or watch. */
export interface StormAlert {
  /** The NWS feature URL — stable for the life of the alert. */
  id: string;
  event: string;
  headline: string | null;
  areaDesc: string | null;
  severity: string | null;
  /** ISO 8601, as NWS sent it. */
  effective: string | null;
  expires: string | null;
  senderName: string | null;
  description: string | null;
  /** Outer rings of the affected area. Often empty for watches (zone-based). */
  polygons: Ring[];

  // Derived once at parse time, so the client never re-derives them.
  category: StormCategory;
  isWarning: boolean;
  isWatch: boolean;
  /** 0 = extreme … 4 = unknown. */
  severityRank: number;
  color: string;
  centroid: LatLng | null;
}

/** A confirmed SPC storm report. */
export interface StormReport {
  /** Deterministic: the same row always gets the same id. */
  id: string;
  category: StormCategory;
  /** UTC "HHMM" as reported. */
  time: string;
  /** F/EF scale, hail inches ("1.75"), or wind mph — possibly "UNK". */
  magnitude: string;
  location: string;
  county: string;
  state: string;
  coord: LatLng;
  comments: string;
  /** The SPC convective day (12Z–12Z) the report belongs to, "YYYY-MM-DD". */
  date: string;

  title: string;
  subtitle: string;
  windMph: number | null;
  hailInches: number | null;
  efRating: number | null;
}

export type OutlookKind = "categorical" | "tornado" | "wind" | "hail";

export interface OutlookProduct {
  day: number;
  kind: OutlookKind;
  /** "day1_cat" */
  id: string;
  /** "Day 1 Categorical" */
  title: string;
  url: string;
  discussionUrl: string;
}

/** One risk area within an outlook product. */
export interface OutlookFeature {
  rings: Ring[];
  /** "SLGT", "0.05", "CIG1" … */
  label: string;
  /** "Slight Risk", "5% Tornado Risk" … */
  detail: string;
  /** Map-ready colors, already tuned for the dark basemap. */
  fillColor: string;
  strokeColor: string;
  /** The SPC color itself, lightly toned — for the legend. */
  swatchColor: string;
  isHatched: boolean;
  cigLevel: number | null;
  isGeneralThunderstorm: boolean;
  /** Pre-computed diagonal hatch slashes (hatched features only). */
  hatch: [LatLng, LatLng][];
}

export interface OutlookData {
  product: OutlookProduct;
  features: OutlookFeature[];
}

export interface RadarFrame {
  /** Unix seconds. */
  time: number;
  /** Leaflet tile template with `{z}/{x}/{y}` placeholders. */
  url: string;
}

export interface RadarManifest {
  past: RadarFrame[];
  nowcast: RadarFrame[];
  /** Unix seconds. */
  generated: number;
  attribution: string;
}

/** A shaded blob synthesized from nearby same-category reports. */
export interface DamageArea {
  category: StormCategory;
  ring: Ring;
  /** Worst report in the cluster, normalized 0 (minor) – 1 (extreme). */
  severity: number;
}

export interface FilterSettings {
  showTornado: boolean;
  showWind: boolean;
  showHail: boolean;
  showWarnings: boolean;
  showWatches: boolean;
  /** 0 = no minimum (unrated reports included). */
  minWindMph: number;
  /** 0 = no minimum. */
  minHailInches: number;
  /** null = no minimum. */
  minTornadoRating: number | null;
  /** 1–5. */
  reportDays: number;
  /** null = no outlook on the map. */
  outlookKind: OutlookKind | null;
  outlookDay: number;
  showRadar: boolean;
  /** 0.1–1. */
  radarOpacity: number;
}

export interface NotificationSettings {
  /** Notify when a new warning covers one of your saved locations. */
  savedLocationAlerts: boolean;
  /** Notify for every new warning that passes your filters. */
  anyWarningAlerts: boolean;
}

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Unix ms. */
  addedAt: number;
}

export interface GeocodeResult {
  /** Short, e.g. "Moore, Oklahoma". */
  name: string;
  /** Nominatim's full display name. */
  detail: string;
  lat: number;
  lon: number;
}

/** The `/api/reports` payload. */
export interface ReportsData {
  reports: StormReport[];
  /** One entry per convective day requested, newest first. */
  days: { date: string; ok: boolean; count: number }[];
}
