/**
 * The vocabulary Outside speaks.
 *
 * Every upstream payload (NWS GeoJSON, SPC CSV and GeoJSON, NHC, NOAA MRMS GRIB2,
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

/**
 * What kind of hazard an NWS alert is about — the families on the Filters
 * screen. Every NWS event maps to exactly one (see `alert-catalog.ts`).
 */
export type AlertGroup =
  | "severe"
  | "tropical"
  | "flood"
  | "coastal"
  | "heat"
  | "winter"
  | "wind"
  | "fire"
  | "marine"
  | "other";

/** The NWS product tier, from the event name's last word. */
export type AlertLevel = "warning" | "watch" | "advisory" | "statement";

/** An active NWS warning, watch, advisory or statement. */
export interface StormAlert {
  /** The NWS feature URL — stable for the life of the alert. */
  id: string;
  event: string;
  headline: string | null;
  areaDesc: string | null;
  severity: string | null;
  /** ISO 8601, as NWS sent it. */
  effective: string | null;
  /** When the hazard ends (NWS `ends`), else when the message expires. */
  expires: string | null;
  senderName: string | null;
  description: string | null;
  /** NWS's "what to do", when it gave one. */
  instruction: string | null;
  /**
   * Outer rings of the affected area. Storm-based warnings carry their own
   * polygon; zone- and county-based alerts get their zones' outlines joined
   * on the server. Empty when no outline could be found.
   */
  polygons: Ring[];
  /** The polygon is NWS's own storm-based one, not a set of zone outlines. */
  stormBased: boolean;

  // Derived once at parse time, so the client never re-derives them.
  /** Tornado / wind / hail for the convective products; null for everything else. */
  category: StormCategory | null;
  group: AlertGroup;
  level: AlertLevel;
  /** Draw and list order: 0 is the most important (NWS's map priority). */
  priority: number;
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

/** SPC's four convective products, plus WPC's Excessive Rainfall Outlook. */
export type OutlookKind = "categorical" | "tornado" | "wind" | "hail" | "rainfall";

export interface OutlookProduct {
  day: number;
  kind: OutlookKind;
  /** "SPC" or "WPC". */
  center: string;
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
  /** The same, tuned for the light basemap. */
  fillColorLight: string;
  strokeColorLight: string;
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
  /** Leaflet tile template with `{z}/{x}/{y}` placeholders, or a WMS endpoint when `wms` is set. */
  url: string;
  /** Present for frames served by a WMS: the layer and any extra GetMap parameters (time). */
  wms?: { layers: string; params: Record<string, string> };
}

/** Radar frames, colored rain vs. snow, drawn by this server from NOAA MRMS. */
export interface PrecipTypeManifest {
  /** Oldest first, the last hour at most. */
  frames: RadarFrame[];
  /** Frames are still being drawn: poll again soon. */
  pending: boolean;
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
  /** Alert families to show; any group not listed is hidden. */
  alertGroups: AlertGroup[];
  showAdvisories: boolean;
  /** Statements and outlooks — the lowest tier, and the noisiest. */
  showStatements: boolean;
  /** NHC storms, forecast cones and the tropical outlook. */
  showTropical: boolean;
  /** A forecast-model animation in place of radar; null = off. */
  forecastProduct: ForecastProductId | null;
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

// --- Tropical ---------------------------------------------------------------

/** NHC's development labels on forecast points. */
export type TropicalStage = "D" | "S" | "H" | "M" | "L" | "X";

export interface TropicalForecastPoint {
  coord: LatLng;
  /** Hours from the advisory (0 = now). */
  tau: number;
  /** "7:00 PM Wed CDT" — the storm's local time, as NHC labels it. */
  label: string;
  /** Knots; null when NHC gave none. */
  windKt: number | null;
  gustKt: number | null;
  stage: TropicalStage;
  /** "Tropical Storm", "Hurricane"… */
  stageName: string;
}

/** A coastal tropical watch or warning segment (`tcww`: TWA, TWR, HWA, HWR). */
export interface TropicalCoastalAlert {
  kind: "TWA" | "TWR" | "HWA" | "HWR" | "SSA" | "SSR";
  line: LatLng[];
}

export interface TropicalPastSegment {
  /** NHC storm type at the time: DB, LO, TD, TS, HU, EX… */
  stormType: string;
  line: LatLng[];
}

export interface TropicalStorm {
  /** "al092026". */
  id: string;
  /** "AT4" — NHC's slot number for the storm. */
  bin: string;
  name: string;
  /** "TS", "HU", "TD", "PTC"… */
  classification: string;
  /** "Tropical Storm Isaias". */
  title: string;
  windMph: number | null;
  pressureMb: number | null;
  position: LatLng;
  /** "ENE at 9 mph"; null when stationary or unknown. */
  movement: string | null;
  /** ISO 8601. */
  updated: string | null;
  advisoryNumber: string | null;
  forecast: TropicalForecastPoint[];
  track: LatLng[];
  cone: Ring[];
  past: TropicalPastSegment[];
  coastal: TropicalCoastalAlert[];
  links: { label: string; href: string }[];
}

/** An area NHC is watching for development (Graphical Tropical Weather Outlook). */
export interface TropicalOutlookArea {
  basin: string;
  /** "Low" / "Medium" / "High". */
  risk2day: string;
  risk7day: string;
  /** "40%". */
  prob2day: string;
  prob7day: string;
  rings: Ring[];
}

/** Where a disturbance NHC is watching is now. */
export interface TropicalDisturbance {
  basin: string;
  coord: LatLng;
  risk2day: string;
  risk7day: string;
  prob2day: string;
  prob7day: string;
}

export interface TropicalData {
  storms: TropicalStorm[];
  outlook: TropicalOutlookArea[];
  disturbances: TropicalDisturbance[];
}

// --- Forecast models ----------------------------------------------------------

export type ForecastProductId =
  | "hrrr-refd"
  | "ndfd-temp"
  | "ndfd-apparent"
  | "ndfd-gust"
  | "ndfd-qpf"
  | "ndfd-sky"
  | "ndfd-pop"
  | "ndfd-snow";

export interface ForecastFrames {
  product: ForecastProductId;
  /** Oldest first. Each frame's `time` is its valid time. */
  frames: RadarFrame[];
  /** Unix seconds of the model run behind the newest frames, when known. */
  runTime: number | null;
  attribution: string;
}
