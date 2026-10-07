import { outerRings } from "./geojson";
import type {
  LatLng,
  Ring,
  TropicalCoastalAlert,
  TropicalData,
  TropicalDisturbance,
  TropicalForecastPoint,
  TropicalOutlookArea,
  TropicalPastSegment,
  TropicalStage,
  TropicalStorm,
} from "./types";

/**
 * National Hurricane Center storms and outlook.
 *
 * `CurrentStorms.json` lists the active storms, each with its NHC "bin" (AT1–5
 * Atlantic, EP1–5 eastern Pacific, CP1–5 central Pacific). NWS's tropical map
 * service publishes each bin's forecast points, track, cone, coastal watches
 * and warnings and past track as queryable layers, which come back as GeoJSON
 * — no shapefiles or KMZ to unpack. Layer ids are looked up by name, so a
 * renumbered service still works.
 */

export const NHC_CURRENT_STORMS_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";
export const NHC_SERVICE_URL =
  "https://mapservices.weather.noaa.gov/tropical/rest/services/tropical/NHC_tropical_weather/MapServer";

export const NHC_ATTRIBUTION = "National Hurricane Center";

const KT_TO_MPH = 1.15078;

/** Knots → mph, rounded to 5 the way NHC writes it (40 kt → 45 mph). */
export function ktToMph(kt: number): number {
  return Math.round((kt * KT_TO_MPH) / 5) * 5;
}

/** The per-storm layers Outside draws, by the suffix after the bin in the layer name. */
export const STORM_LAYERS = {
  points: "Forecast Points",
  track: "Forecast Track",
  cone: "Forecast Cone",
  coastal: "Watch-Warning",
  past: "Past Track",
} as const;

export type StormLayer = keyof typeof STORM_LAYERS;

export const OUTLOOK_LAYERS = {
  areas: "Seven-Day: Potential Development Region",
  points: "Seven-Day: Current Location",
} as const;

export function layerQueryUrl(layerId: number): string {
  return (
    `${NHC_SERVICE_URL}/${layerId}/query?where=1%3D1&outFields=*&returnGeometry=true` +
    "&f=geojson&geometryPrecision=3&outSR=4326"
  );
}

/** The service's layer list → id by exact name. */
export function parseLayerIndex(json: unknown): Map<string, number> {
  const out = new Map<string, number>();
  const layers = (json as { layers?: unknown })?.layers;
  if (!Array.isArray(layers)) return out;
  for (const l of layers) {
    const { id, name } = (l ?? {}) as { id?: unknown; name?: unknown };
    if (typeof id === "number" && typeof name === "string") out.set(name.trim(), id);
  }
  return out;
}

export function stormLayerId(index: Map<string, number>, bin: string, layer: StormLayer): number | null {
  return index.get(`${bin} ${STORM_LAYERS[layer]}`) ?? null;
}

// --- Parsing ------------------------------------------------------------------

type Props = Record<string, unknown>;

function features(json: unknown): { props: Props; geometry: unknown }[] {
  const list = (json as { features?: unknown })?.features;
  if (!Array.isArray(list)) return [];
  return list.map((f) => ({
    props: ((f as { properties?: unknown })?.properties ?? {}) as Props,
    geometry: (f as { geometry?: unknown })?.geometry,
  }));
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  // NHC writes 9999 for "not given".
  return typeof n === "number" && Number.isFinite(n) && n < 9000 ? n : null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function point(geometry: unknown): LatLng | null {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (g?.type !== "Point" || !Array.isArray(g.coordinates)) return null;
  const [lon, lat] = g.coordinates as unknown[];
  return typeof lat === "number" && typeof lon === "number" ? [lat, lon] : null;
}

/** LineString / MultiLineString → lines of `[lat, lon]`. */
export function lines(geometry: unknown): LatLng[][] {
  const g = geometry as { type?: unknown; coordinates?: unknown } | null;
  if (!g || !Array.isArray(g.coordinates)) return [];
  const toLine = (coords: unknown): LatLng[] =>
    Array.isArray(coords)
      ? coords.flatMap((p): LatLng[] =>
          Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" ? [[p[1], p[0]]] : [],
        )
      : [];
  if (g.type === "LineString") return [toLine(g.coordinates)].filter((l) => l.length >= 2);
  if (g.type === "MultiLineString") return g.coordinates.map(toLine).filter((l) => l.length >= 2);
  return [];
}

const STAGE_NAMES: Record<TropicalStage, string> = {
  D: "Tropical Depression",
  S: "Tropical Storm",
  H: "Hurricane",
  M: "Major Hurricane",
  L: "Post-Tropical",
  X: "Disturbance",
};

export function stageName(stage: TropicalStage): string {
  return STAGE_NAMES[stage];
}

function stage(v: unknown): TropicalStage {
  const s = text(v).toUpperCase();
  return s === "D" || s === "S" || s === "H" || s === "M" || s === "L" ? s : "X";
}

export function parseForecastPoints(json: unknown): TropicalForecastPoint[] {
  return features(json)
    .flatMap(({ props, geometry }): TropicalForecastPoint[] => {
      const coord = point(geometry);
      if (!coord) return [];
      const s = stage(props.dvlbl);
      return [
        {
          coord,
          tau: num(props.tau) ?? 0,
          // NHC labels points in the storm's local time; say which.
          label: [text(props.datelbl), text(props.timezone)].filter(Boolean).join(" "),
          windKt: num(props.maxwind),
          gustKt: num(props.gust),
          stage: s,
          stageName: text(props.tcdvlp) || STAGE_NAMES[s],
        },
      ];
    })
    .sort((a, b) => a.tau - b.tau);
}

export function parseTrack(json: unknown): LatLng[] {
  return features(json).flatMap(({ geometry }) => lines(geometry).flat());
}

export function parseCone(json: unknown): Ring[] {
  return features(json).flatMap(({ geometry }) => outerRings(geometry));
}

const COASTAL_KINDS = new Set(["TWA", "TWR", "HWA", "HWR", "SSA", "SSR"]);

export function parseCoastal(json: unknown): TropicalCoastalAlert[] {
  return features(json).flatMap(({ props, geometry }) => {
    const kind = text(props.tcww).toUpperCase();
    if (!COASTAL_KINDS.has(kind)) return [];
    return lines(geometry).map((line) => ({ kind: kind as TropicalCoastalAlert["kind"], line }));
  });
}

export function parsePastTrack(json: unknown): TropicalPastSegment[] {
  return features(json).flatMap(({ props, geometry }) =>
    lines(geometry).map((line) => ({ stormType: text(props.stormtype).toUpperCase(), line })),
  );
}

export function parseOutlookAreas(json: unknown): TropicalOutlookArea[] {
  return features(json).flatMap(({ props, geometry }) => {
    const rings = outerRings(geometry);
    if (rings.length === 0) return [];
    return [
      {
        basin: text(props.basin),
        risk2day: text(props.risk2day),
        risk7day: text(props.risk7day),
        prob2day: text(props.prob2day),
        prob7day: text(props.prob7day),
        rings,
      },
    ];
  });
}

export function parseDisturbances(json: unknown): TropicalDisturbance[] {
  return features(json).flatMap(({ props, geometry }) => {
    const coord = point(geometry);
    if (!coord) return [];
    return [
      {
        basin: text(props.basin),
        coord,
        risk2day: text(props.risk2day),
        risk7day: text(props.risk7day),
        prob2day: text(props.prob2day),
        prob7day: text(props.prob7day),
      },
    ];
  });
}

const CLASSIFICATION: Record<string, string> = {
  TD: "Tropical Depression",
  TS: "Tropical Storm",
  HU: "Hurricane",
  MH: "Major Hurricane",
  TY: "Typhoon",
  STD: "Subtropical Depression",
  STS: "Subtropical Storm",
  PTC: "Potential Tropical Cyclone",
  PC: "Post-Tropical Cyclone",
  TC: "Tropical Cyclone",
  DB: "Disturbance",
};

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compass(degrees: number): string {
  return COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** "Tropical Storm Isaias"; numbered storms ("Twenty-E") keep NHC's depression name. */
export function stormTitle(classification: string, name: string): string {
  const kind = CLASSIFICATION[classification.toUpperCase()] ?? "Tropical Cyclone";
  return `${kind} ${name}`.trim();
}

/** The storm list from `CurrentStorms.json`, without geometry yet. */
export function parseCurrentStorms(json: unknown): TropicalStorm[] {
  const list = (json as { activeStorms?: unknown })?.activeStorms;
  if (!Array.isArray(list)) return [];
  return list.flatMap((raw): TropicalStorm[] => {
    const s = (raw ?? {}) as Props;
    const id = text(s.id);
    const bin = text(s.binNumber).toUpperCase();
    const lat = num(s.latitudeNumeric);
    const lon = num(s.longitudeNumeric);
    if (!id || !bin || lat === null || lon === null) return [];

    const classification = text(s.classification).toUpperCase();
    const name = text(s.name);
    const kt = num(s.intensity);
    const dir = num(s.movementDir);
    const speed = num(s.movementSpeed);
    const link = (key: string, label: string) => {
      const url = text(((s[key] ?? {}) as Props).url);
      return url ? [{ label, href: url }] : [];
    };

    return [
      {
        id,
        bin,
        name,
        classification,
        title: stormTitle(classification, name),
        windMph: kt === null ? null : ktToMph(kt),
        pressureMb: num(s.pressure),
        position: [lat, lon],
        movement: dir !== null && speed !== null && speed > 0 ? `${compass(dir)} at ${speed} mph` : null,
        updated: text(s.lastUpdate) || null,
        advisoryNumber: text(((s.publicAdvisory ?? {}) as Props).advNum) || null,
        forecast: [],
        track: [],
        cone: [],
        past: [],
        coastal: [],
        links: [
          ...link("publicAdvisory", "Public advisory"),
          ...link("forecastDiscussion", "Forecast discussion"),
          ...link("forecastGraphics", "NHC graphics"),
        ],
      },
    ];
  });
}

/** Saffir–Simpson-ish colors by NHC stage, for forecast points and the storm's chip. */
export function stageColor(stage: TropicalStage): string {
  switch (stage) {
    case "D":
      return "#4FA3FF";
    case "S":
      return "#2ECC71";
    case "H":
      return "#FF9F1C";
    case "M":
      return "#E0245E";
    default:
      return "#B0B0B8";
  }
}

/** The stage a storm is at now: its first forecast point, else from its classification and wind. */
export function currentStage(storm: TropicalStorm): TropicalStage {
  if (storm.forecast.length > 0) return storm.forecast[0].stage;
  const c = storm.classification;
  if (c === "TD" || c === "STD") return "D";
  if (c === "TS" || c === "STS") return "S";
  if (c === "HU" || c === "TY" || c === "MH") return (storm.windMph ?? 0) >= 111 ? "M" : "H";
  return "X";
}

/** Past-track colors by the storm type at the time. */
export function pastColor(stormType: string): string {
  switch (stormType) {
    case "TD":
    case "SD":
      return "#4FA3FF";
    case "TS":
    case "SS":
      return "#2ECC71";
    case "HU":
    case "TY":
      return "#FF9F1C";
    case "MH":
      return "#E0245E";
    default:
      return "#9A9AA6";
  }
}

const COASTAL_META: Record<TropicalCoastalAlert["kind"], { name: string; color: string }> = {
  HWR: { name: "Hurricane Warning", color: "#DC143C" },
  HWA: { name: "Hurricane Watch", color: "#FF66FF" },
  TWR: { name: "Tropical Storm Warning", color: "#2F6BFF" },
  TWA: { name: "Tropical Storm Watch", color: "#F5D300" },
  SSR: { name: "Storm Surge Warning", color: "#B524F7" },
  SSA: { name: "Storm Surge Watch", color: "#DB7FF7" },
};

export function coastalName(kind: TropicalCoastalAlert["kind"]): string {
  return COASTAL_META[kind].name;
}

export function coastalColor(kind: TropicalCoastalAlert["kind"]): string {
  return COASTAL_META[kind].color;
}

/** Outlook areas by 7-day chance, NHC's yellow / orange / red. */
export function outlookRiskColor(risk: string): string {
  switch (risk.toLowerCase()) {
    case "high":
      return "#FF3B30";
    case "medium":
      return "#FF9500";
    default:
      return "#FFD60A";
  }
}

export const EMPTY_TROPICAL: TropicalData = { storms: [], outlook: [], disturbances: [] };
