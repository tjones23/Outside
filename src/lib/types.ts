import type { SnotelDepth, SnotelReport } from "./snotel";

/**
 * The vocabulary Outside speaks.
 *
 * Every upstream payload (NWS GeoJSON, SPC CSV and GeoJSON, NHC, NOAA MRMS GRIB2,
 * Nominatim JSON) is parsed into these shapes in `src/lib/`, and nothing in
 * `src/app` or `src/components` ever sees a raw one. They are also the wire
 * format of the `/api/*` routes, so everything here must stay plain JSON.
 *
 * Coordinates are `[lat, lon]` tuples throughout. GeoJSON's `[lon, lat]` is
 * swapped on the way in, in `geojson.ts`, and back for the map, in
 * `map-features.ts`.
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
  /** Tile template with `{z}/{x}/{y}` placeholders. */
  url: string;
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
  /** Wildfire incidents and their perimeters (NIFC). */
  showFires: boolean;
  /** VIIRS satellite hotspots, the last day. */
  showHotspots: boolean;
  /** NOAA HMS smoke plumes. */
  showSmoke: boolean;
  /** EPA AirNow monitors, colored by AQI. */
  showAirQuality: boolean;
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
  /** Set when it was saved from the ski resort list. */
  resortId?: string;
}

/** One NWS forecast period ("Tonight", "Wednesday"), with the grid's amounts over its hours. */
export interface ForecastPeriod {
  name: string;
  /** ISO, with the place's own offset. */
  start: string;
  end: string;
  isDaytime: boolean;
  /** °F: the high for a day period, the low for a night. */
  temperature: number | null;
  /** Percent. */
  precipChance: number | null;
  /** "Snow Likely". */
  short: string;
  /** The forecasters' full wording, accumulation ranges included. */
  detail: string;
  /** New snow, inches; null where NWS's grid doesn't reach. */
  snowIn: number | null;
  /** Liquid precipitation (rain plus melted snow), inches; null where the grid doesn't reach. */
  precipIn: number | null;
}

/** A day period and the night after it — 6 AM to 6 AM. The first may be a night alone. */
export interface ForecastDay {
  /** The local date it starts on, "2026-10-14". */
  date: string;
  /** NWS's name for its first period: "Today", "Tonight", "Wednesday". */
  name: string;
  high: number | null;
  low: number | null;
  /** The higher of its periods' chances. */
  precipChance: number | null;
  summary: string;
  /** Null unless the grid covers the whole row. */
  snowIn: number | null;
  precipIn: number | null;
  periods: ForecastPeriod[];
}

/** The `/api/point-forecast` payload. */
export interface PointForecast {
  /** NWS's nearest named place, "Alta, UT". */
  place: string | null;
  /** When the forecasters last issued it. */
  updated: string | null;
  days: ForecastDay[];
  /** The grid failed, so there are no snow or precipitation amounts this time. */
  amountsMissing: boolean;
}

/** One model's snow over some stretch, inches. Ensembles give their mean and 10th–90th percentile. */
export interface BlendModelTotal {
  /** A `BLEND_MODELS` key. */
  key: string;
  snowIn: number;
  p10In?: number;
  p90In?: number;
  members?: number;
}

/** The blended snow over some stretch, with the range the models span. */
export interface BlendSpan {
  /** Null unless the blend covers all of it. */
  snowIn: number | null;
  /** Lowest single model or ensemble 10th percentile. */
  lowIn: number | null;
  /** Highest single model or ensemble 90th percentile. */
  highIn: number | null;
  models: BlendModelTotal[];
}

/** A 6 AM–6 AM day of the snow blend; the first may be a night alone. */
export interface BlendDay extends BlendSpan {
  /** The local date it starts on. */
  date: string;
  nightOnly: boolean;
  /** Blended snow, 6 AM–6 PM and 6 PM–6 AM. */
  dayIn: number | null;
  nightIn: number | null;
  /** Liquid precipitation, rain and melted snow, inches. */
  precipIn: number | null;
  /** Snow-to-liquid ratio of the blend (15 means 15:1), when there's snow to speak of. */
  ratio: number | null;
  /** Blended °F. */
  high: number | null;
  low: number | null;
}

/** The `/api/snow-blend` payload. */
export interface SnowBlend {
  /** The spot's IANA zone. */
  timezone: string;
  /** The terrain height temperatures were corrected to, m. */
  elevationM: number | null;
  /** Up to 15. */
  days: BlendDay[];
  /** "Next 5 days", "Days 6–10", "Days 11–15". */
  periods: (BlendSpan & { label: string })[];
  /** `BLEND_MODELS` keys that answered, and that didn't. */
  loaded: string[];
  failed: string[];
}

/** The models' snow over some stretch of the past, inches. */
export interface PastSpan {
  /** Null unless the hindcast covers all of it. */
  snowIn: number | null;
  /** Lowest and highest single model. */
  lowIn: number | null;
  highIn: number | null;
  models: BlendModelTotal[];
}

/** A 6 AM–6 AM day of the hindcast. */
export interface PastDay extends PastSpan {
  date: string;
  /** Today's row, still going. */
  partial: boolean;
  /** Liquid precipitation, inches. */
  precipIn: number | null;
}

/** The `/api/snow-past` payload: what the models say fell, and what the nearest SNOTEL measured. */
export interface SnowPast {
  timezone: string;
  elevationM: number | null;
  /** Oldest first, up to 15 plus today's. */
  days: PastDay[];
  /** "Last 5 days", "6–10 days ago", "11–15 days ago", counted back from now. */
  periods: (PastSpan & { label: string })[];
  loaded: string[];
  failed: string[];
  /** Null when there's no station near, or SNOTEL is down. */
  snotel: SnotelReport | null;
}

/** The `/api/snow-depth` payload. */
export interface SnowDepths {
  stations: SnotelDepth[];
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
  /** Knots, as NHC reports it; `windMph` is the rounded mph. */
  windKt: number | null;
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

// --- Wildfire -----------------------------------------------------------------

/** A wildfire that isn't out yet, from NIFC's interagency record (WFIGS). */
export interface WildfireIncident {
  /** IRWIN id, lowercase without braces — shared with the fire's perimeter. */
  id: string;
  /** "Sacaton Fire". */
  name: string;
  /** Where it started. */
  coord: LatLng;
  acres: number | null;
  /** 0–100; null when not reported (usually a new start). */
  contained: number | null;
  /** ISO 8601. */
  discovered: string | null;
  updated: string | null;
  /** "Human", "Natural", "Undetermined". */
  cause: string | null;
  /** "Minimal", "Moderate", "Active", "Extreme". */
  behavior: string | null;
  /** "15 Miles E from Glenwood, NM". */
  location: string | null;
  county: string | null;
  /** Two-letter state. */
  state: string | null;
  /** The protecting agency: "USFS", "BLM", "State"… */
  agency: string | null;
  personnel: number | null;
  /** "2026-NMGNF-000354". */
  fireId: string | null;
}

export interface WildfirePerimeter {
  /** IRWIN id of the incident it outlines. */
  id: string;
  name: string;
  rings: Ring[];
  acres: number | null;
  /** When the perimeter was mapped, ISO 8601. */
  mapped: string | null;
}

/** The `/api/fires` payload. */
export interface WildfireData {
  incidents: WildfireIncident[];
  perimeters: WildfirePerimeter[];
  /** Perimeters failed to load; incidents are still current. */
  perimetersMissing: boolean;
}

export type HotspotConfidence = "low" | "nominal" | "high";

/** One VIIRS fire detection: a 375 m pixel hot enough to be burning. */
export interface Hotspot {
  coord: LatLng;
  /** When the satellite saw it, Unix ms. */
  time: number;
  /** Fire radiative power, megawatts. */
  frp: number | null;
  confidence: HotspotConfidence;
  /** "N", "N20", "N21". */
  satellite: string;
}

export type SmokeDensity = "light" | "medium" | "heavy";

export interface SmokePlume {
  density: SmokeDensity;
  rings: Ring[];
  /** The window of imagery the plume was drawn from, ISO 8601. */
  start: string | null;
  end: string | null;
  satellite: string | null;
}

/** The `/api/smoke` payload: one UTC day's HMS analysis. */
export interface SmokeData {
  /** "YYYY-MM-DD", UTC — today's, or yesterday's until today's is published. */
  date: string;
  plumes: SmokePlume[];
}

// --- Air quality --------------------------------------------------------------

export type AirPollutant = "pm25" | "ozone" | "pm10" | "no2";

/** One air-quality monitor's latest hour, from EPA AirNow. */
export interface AirQualitySite {
  /** AirNow's AQS site id. */
  id: string;
  name: string;
  coord: LatLng;
  /** The worst pollutant's AQI. */
  aqi: number;
  pollutant: AirPollutant;
  /** AQI for each pollutant the monitor reported. */
  byPollutant: Partial<Record<AirPollutant, number>>;
  /** PM2.5 concentration, µg/m³, when measured (never negative). */
  pm25: number | null;
  /** The agency that runs the monitor. */
  agency: string | null;
  /** The hour the reading is for, ISO 8601. */
  observed: string;
}

/** The `/api/air` payload. */
export interface AirQualityData {
  /** The hour shown, ISO 8601 (UTC). */
  hour: string;
  sites: AirQualitySite[];
}
