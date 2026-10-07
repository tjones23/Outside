import type { ForecastFrames, ForecastProductId, RadarFrame } from "./types";

/**
 * Forecast animations — what the weather is predicted to do, frame by frame.
 *
 * Two free, keyless sources:
 *
 * - **HRRR simulated radar** from the Iowa Environmental Mesonet, which renders
 *   NOAA's High-Resolution Rapid Refresh model (3 km, run hourly) as map tiles,
 *   every 15 minutes out to 18 hours. Outside steps through it hourly. IEM
 *   publishes a small JSON per forecast minute naming the run behind it, so
 *   each frame carries its own valid time even while a new run is landing.
 *
 * - **The National Digital Forecast Database** (NWS's official gridded
 *   forecast, which forecasters build from the models) over its WMS:
 *   temperature, feels-like, gusts, rain, sky cover, rain chance and snow, out
 *   to seven days. The valid times come from its GetCapabilities document.
 */

export interface ForecastProductInfo {
  id: ForecastProductId;
  name: string;
  /** Who made it, for the timeline and the About page. */
  source: string;
  /** What the colors mean; shown under the legend. */
  units: string;
  /** Tiles past this zoom are stretched rather than fetched. */
  maxNativeZoom: number;
  /** The NDFD element, for WMS products. */
  ndfd?: { layer: string; element: string };
}

export const FORECAST_PRODUCTS: readonly ForecastProductInfo[] = [
  { id: "hrrr-refd", name: "Future radar (HRRR)", source: "NOAA HRRR via Iowa Environmental Mesonet", units: "dBZ", maxNativeZoom: 8 },
  { id: "ndfd-temp", name: "Temperature", source: "NWS forecast (NDFD)", units: "°F", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.t", element: "t" } },
  { id: "ndfd-apparent", name: "Feels like", source: "NWS forecast (NDFD)", units: "°F", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.apparentt", element: "apparentt" } },
  { id: "ndfd-gust", name: "Wind gusts", source: "NWS forecast (NDFD)", units: "mph", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.windgust", element: "windgust" } },
  { id: "ndfd-qpf", name: "Rain (6-hour total)", source: "NWS forecast (NDFD)", units: "inches", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.qpf", element: "qpf" } },
  { id: "ndfd-pop", name: "Chance of rain (12-hour)", source: "NWS forecast (NDFD)", units: "%", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.pop12", element: "pop12" } },
  { id: "ndfd-sky", name: "Cloud cover", source: "NWS forecast (NDFD)", units: "%", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.sky", element: "sky" } },
  { id: "ndfd-snow", name: "Snow (6-hour total)", source: "NWS forecast (NDFD)", units: "inches", maxNativeZoom: 8, ndfd: { layer: "ndfd.conus.snowamt", element: "snowamt" } },
];

const BY_ID = new Map(FORECAST_PRODUCTS.map((p) => [p.id, p]));

export function isForecastProduct(value: unknown): value is ForecastProductId {
  return typeof value === "string" && BY_ID.has(value as ForecastProductId);
}

export function forecastProduct(id: ForecastProductId): ForecastProductInfo {
  return BY_ID.get(id)!;
}

// --- HRRR (IEM) -------------------------------------------------------------

const IEM = "https://mesonet.agron.iastate.edu";
export const HRRR_ATTRIBUTION = "HRRR · Iowa Environmental Mesonet";

/** Every forecast hour IEM renders (0–18 h), in minutes. */
export const HRRR_MINUTES: readonly number[] = Array.from({ length: 19 }, (_, h) => h * 60);

const pad4 = (n: number) => String(n).padStart(4, "0");

export function hrrrMetaUrl(minute: number): string {
  return `${IEM}/data/gis/images/4326/hrrr/refd_${pad4(minute)}.json`;
}

/** "2026-10-07T14:00:00Z" → "202610071400", IEM's cache-busting stamp. */
function stamp(iso: string): string {
  return iso.replace(/[^0-9]/g, "").slice(0, 12);
}

export function hrrrTileUrl(minute: number, runIso: string): string {
  return `${IEM}/cache/tile.py/1.0.0/hrrr::REFD-F${pad4(minute)}-${stamp(runIso)}/{z}/{x}/{y}.png`;
}

export interface HrrrMeta {
  minute: number;
  run: string;
  valid: string;
}

/** One `refd_XXXX.json` → its run and valid time, or null if it's not what we expect. */
export function parseHrrrMeta(minute: number, json: unknown): HrrrMeta | null {
  const r = json as { model_init_utc?: unknown; model_forecast_utc?: unknown } | null;
  const run = r?.model_init_utc;
  const valid = r?.model_forecast_utc;
  if (typeof run !== "string" || typeof valid !== "string") return null;
  if (Number.isNaN(Date.parse(run)) || Number.isNaN(Date.parse(valid))) return null;
  return { minute, run, valid };
}

/**
 * Frames from whatever forecast minutes answered, oldest valid time first.
 * Mid-run, early minutes are from the new run and late ones from the last;
 * each frame's time is its own, and duplicates (two runs valid at the same
 * hour) keep the newer run.
 */
export function buildHrrrFrames(metas: (HrrrMeta | null)[]): ForecastFrames {
  const byValid = new Map<number, { frame: RadarFrame; run: number }>();
  let newestRun = 0;
  for (const m of metas) {
    if (!m) continue;
    const valid = Date.parse(m.valid) / 1000;
    const run = Date.parse(m.run) / 1000;
    newestRun = Math.max(newestRun, run);
    const existing = byValid.get(valid);
    if (existing && existing.run >= run) continue;
    byValid.set(valid, { frame: { time: valid, url: hrrrTileUrl(m.minute, m.run) }, run });
  }
  const frames = [...byValid.values()].map((v) => v.frame).sort((a, b) => a.time - b.time);
  return { product: "hrrr-refd", frames, runTime: newestRun || null, attribution: HRRR_ATTRIBUTION };
}

// --- NDFD (NWS WMS) ---------------------------------------------------------

export const NDFD_WMS_URL = "https://digital.weather.gov/ndfd/wms";
/**
 * The CONUS-only capabilities document: a third the size of the national one
 * (~0.5 MB), and the same valid times. Still slow to generate — seconds —
 * which is why it gets a longer timeout than other requests.
 */
export const NDFD_CAPABILITIES_URL = "https://digital.weather.gov/ndfd.conus/wms?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.1.1";
export const NDFD_ATTRIBUTION = "National Weather Service NDFD";

/** NWS's own color bar for an element, as an image. */
export function ndfdLegendUrl(element: string, width = 600): string {
  return `https://digital.weather.gov/scripts/wxmap_legendImage.php?dataset=ndfd&element=${element}&region=conus&opacity=1&width=${width}`;
}

/** Valid times per layer, from the capabilities document's `vtit` dimensions. */
export function parseNdfdTimes(xml: string, layer: string): string[] {
  const at = xml.indexOf(`<Name>${layer}</Name>`);
  if (at < 0) return [];
  const end = xml.indexOf("</Layer>", at);
  const body = xml.slice(at, end < 0 ? undefined : end);
  const m = /<Dimension name="vtit"[^>]*>([^<]*)<\/Dimension>/.exec(body);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(t));
}

const HOUR = 3600;

/**
 * Which valid times to animate: from the last one at or before now, at least
 * 3 hours apart for the first three days and 6 after, at most `max` frames.
 * NDFD's temperature grid alone has 80-odd times; every one would be a
 * second's worth of tiles from NWS per pan.
 */
export function pickNdfdTimes(times: string[], now: number, max = 40): string[] {
  const parsed = times
    .map((t) => ({ t, s: Date.parse(`${t}:00Z`) / 1000 }))
    .filter((x) => !Number.isNaN(x.s))
    .sort((a, b) => a.s - b.s);
  const nowS = now / 1000;
  let start = 0;
  for (let i = 0; i < parsed.length; i++) if (parsed[i].s <= nowS) start = i;

  const out: { t: string; s: number }[] = [];
  for (const x of parsed.slice(start)) {
    const last = out.at(-1);
    const gap = x.s - parsed[start].s < 72 * HOUR ? 3 * HOUR : 6 * HOUR;
    if (!last || x.s - last.s >= gap) out.push(x);
    if (out.length >= max) break;
  }
  return out.map((x) => x.t);
}

export function buildNdfdFrames(product: ForecastProductInfo, times: string[]): ForecastFrames {
  const layer = product.ndfd!.layer;
  return {
    product: product.id,
    frames: times.map((t) => ({
      time: Date.parse(`${t}:00Z`) / 1000,
      url: NDFD_WMS_URL,
      wms: { layers: layer, params: { vtit: t } },
    })),
    runTime: null,
    attribution: NDFD_ATTRIBUTION,
  };
}

/** NWS-style reflectivity colors, for the HRRR legend. */
export const REFLECTIVITY_STOPS: [dbz: number, color: string][] = [
  [5, "#04E9E7"],
  [10, "#019FF4"],
  [15, "#0300F4"],
  [20, "#02FD02"],
  [25, "#01C501"],
  [30, "#008E00"],
  [35, "#FDF802"],
  [40, "#E5BC00"],
  [45, "#FD9500"],
  [50, "#FD0000"],
  [55, "#D40000"],
  [60, "#BC0000"],
  [65, "#F800FD"],
  [70, "#9854C6"],
];
