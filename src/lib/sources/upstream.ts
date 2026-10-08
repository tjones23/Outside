import {
  NWS_ALERTS_URL,
  NWS_WWA_OUTLINES_URL,
  parseAffectedZones,
  parseNwsAlerts,
  parseWwaOutlines,
  parseZoneOutline,
  withOutlines,
  zonesStillNeeded,
} from "../alerts";
import {
  buildHrrrFrames,
  buildNdfdFrames,
  forecastProduct,
  HRRR_MINUTES,
  hrrrMetaUrl,
  NDFD_CAPABILITIES_URL,
  parseHrrrMeta,
  parseNdfdTimes,
  pickNdfdTimes,
} from "../forecast";
import { nominatimUrl, parseNominatim } from "../geocode";
import { mrmsFileUrl, type MrmsProduct } from "../mrms";
import { buildOutlook } from "../outlook";
import { createRateLimiterState, recordHit } from "../rate-limit";
import { parseSpcCsv, reportsUrl } from "../reports";
import {
  layerQueryUrl,
  NHC_CURRENT_STORMS_URL,
  NHC_SERVICE_URL,
  OUTLOOK_LAYERS,
  parseCone,
  parseCoastal,
  parseCurrentStorms,
  parseDisturbances,
  parseForecastPoints,
  parseLayerIndex,
  parseOutlookAreas,
  parsePastTrack,
  parseTrack,
  stormLayerId,
  type StormLayer,
} from "../tropical";
import type {
  ForecastFrames,
  ForecastProductId,
  GeocodeResult,
  OutlookData,
  OutlookProduct,
  Ring,
  StormAlert,
  StormReport,
  TropicalData,
  TropicalStorm,
} from "../types";

/**
 * Every upstream request, uncached and framework-free.
 *
 * `cached.ts` wraps these with `use cache` for the app; `scripts/check-sources.ts`
 * calls them directly to smoke-test each feed. Each one throws on failure —
 * never returns an empty result for an error — so a failure is never mistaken
 * for "no storms" and never baked into a cache entry.
 */

const TIMEOUT_MS = 15_000;
const DEFAULT_CONTACT = "https://github.com/tjones23/Outside";

/**
 * NWS rejects requests without an identifying User-Agent, and Nominatim's
 * usage policy asks for one — which is also why these calls can't come from
 * the browser, where User-Agent can't be set.
 */
export function userAgent(): string {
  const contact = process.env.OUTSIDE_CONTACT?.trim() || DEFAULT_CONTACT;
  return `Outside/1.0 (contact: ${contact})`;
}

export class UpstreamError extends Error {
  constructor(
    readonly url: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

async function get(url: string, accept: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: accept },
      signal: AbortSignal.timeout(timeoutMs),
      // Caching is `use cache`'s job; don't let fetch add a second layer.
      cache: "no-store",
    });
  } catch (error) {
    throw new UpstreamError(url, null, `${new URL(url).host}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new UpstreamError(url, response.status, `${new URL(url).host} answered ${response.status}`);
  }
  return response;
}

/** The NWS alert list, and each alert's zone URLs (for outlines the map service lacks). */
export interface AlertFeed {
  alerts: StormAlert[];
  zones: Record<string, string[]>;
}

export async function fetchAlertFeed(): Promise<AlertFeed> {
  const response = await get(NWS_ALERTS_URL, "application/geo+json");
  const json: unknown = await response.json();
  return { alerts: parseNwsAlerts(json), zones: Object.fromEntries(parseAffectedZones(json)) };
}

/** Outlines of zone-based alerts by CAP id, from NWS's map service. */
export async function fetchWwaOutlines(): Promise<Record<string, Ring[]>> {
  const response = await get(NWS_WWA_OUTLINES_URL, "application/geo+json, application/json");
  return Object.fromEntries(parseWwaOutlines(await response.json()));
}

/** One zone's simplified outline. A zone NWS doesn't know (404) has none. */
export async function fetchZoneOutline(zoneUrl: string): Promise<Ring[]> {
  if (!zoneUrl.startsWith("https://api.weather.gov/zones/")) return [];
  try {
    const response = await get(zoneUrl, "application/geo+json");
    return parseZoneOutline(await response.json());
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) return [];
    throw error;
  }
}

/** At most this many zone lookups per alerts request; the rest wait for the next poll. */
export const MAX_ZONE_LOOKUPS = 120;
const ZONE_CONCURRENCY = 6;

/** `fn` over `items`, at most `limit` at a time, in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Alerts with every outline that can be found. The outline sources are
 * best-effort: if the map service is down, alerts still list, they just
 * can't all be drawn. `loadZone` is injectable so the app can put a cache in
 * front of each zone; zone outlines practically never change.
 */
export async function joinOutlines(
  feed: AlertFeed,
  outlines: Record<string, Ring[]> | null,
  loadZone: (url: string) => Promise<Ring[] | null>,
): Promise<StormAlert[]> {
  const byCap = new Map(Object.entries(outlines ?? {}));
  const zonesOf = new Map(Object.entries(feed.zones));
  const needed = zonesStillNeeded(feed.alerts, byCap, zonesOf).slice(0, MAX_ZONE_LOOKUPS);
  const rings = await mapLimit(needed, ZONE_CONCURRENCY, loadZone);
  const byZone = new Map<string, Ring[]>();
  needed.forEach((zone, i) => {
    const r = rings[i];
    if (r && r.length > 0) byZone.set(zone, r);
  });
  return withOutlines(feed.alerts, byCap, zonesOf, byZone);
}

/** Every active alert, outlined — uncached, for `check:sources`. */
export async function fetchAlerts(): Promise<StormAlert[]> {
  const [feed, outlines] = await Promise.all([fetchAlertFeed(), fetchWwaOutlines().catch(() => null)]);
  return joinOutlines(feed, outlines, (url) => fetchZoneOutline(url).catch(() => null));
}

/**
 * One convective day of reports.
 *
 * A past day's file that doesn't exist (404) is a real "no file" — SPC only
 * publishes a dated file once the day has closed — and comes back empty.
 * Anything else that goes wrong throws.
 */
export async function fetchReportDay(date: string, isToday: boolean): Promise<StormReport[]> {
  try {
    const response = await get(reportsUrl(date, isToday), "text/csv, text/plain, */*");
    return parseSpcCsv(await response.text(), date);
  } catch (error) {
    if (!isToday && error instanceof UpstreamError && error.status === 404) return [];
    throw error;
  }
}

export async function fetchOutlook(product: OutlookProduct): Promise<OutlookData> {
  const response = await get(product.url, "application/geo+json, application/json");
  return buildOutlook(product, await response.json());
}

// --- Tropical -----------------------------------------------------------------

async function getJson(url: string): Promise<unknown> {
  const response = await get(url, "application/geo+json, application/json");
  return response.json();
}

/**
 * Active storms with their forecast, cone, coastal alerts and past track,
 * plus the 7-day outlook. A storm whose geometry fails still lists from
 * `CurrentStorms.json`; only that file and the layer list failing is an error.
 */
export async function fetchTropical(): Promise<TropicalData> {
  const [current, layerList] = await Promise.all([getJson(NHC_CURRENT_STORMS_URL), getJson(`${NHC_SERVICE_URL}?f=json`)]);
  const index = parseLayerIndex(layerList);
  const storms = parseCurrentStorms(current);

  const layer = async <T>(id: number | null | undefined, parse: (json: unknown) => T, empty: T): Promise<T> => {
    if (id === null || id === undefined) return empty;
    try {
      return parse(await getJson(layerQueryUrl(id)));
    } catch {
      return empty;
    }
  };
  const stormLayer = <T>(storm: TropicalStorm, name: StormLayer, parse: (json: unknown) => T, empty: T) =>
    layer(stormLayerId(index, storm.bin, name), parse, empty);

  const [filled, outlook, disturbances] = await Promise.all([
    Promise.all(
      storms.map(async (storm): Promise<TropicalStorm> => {
        const [forecast, track, cone, coastal, past] = await Promise.all([
          stormLayer(storm, "points", parseForecastPoints, []),
          stormLayer(storm, "track", parseTrack, []),
          stormLayer(storm, "cone", parseCone, []),
          stormLayer(storm, "coastal", parseCoastal, []),
          stormLayer(storm, "past", parsePastTrack, []),
        ]);
        return { ...storm, forecast, track, cone, coastal, past };
      }),
    ),
    layer(index.get(OUTLOOK_LAYERS.areas), parseOutlookAreas, []),
    layer(index.get(OUTLOOK_LAYERS.points), parseDisturbances, []),
  ]);
  return { storms: filled, outlook, disturbances };
}

// --- Forecast animations -----------------------------------------------------

/** Every valid time NDFD lists for one WMS layer. */
export async function fetchNdfdTimes(layer: string): Promise<string[]> {
  const response = await get(NDFD_CAPABILITIES_URL, "application/vnd.ogc.wms_xml, text/xml, */*", 45_000);
  const times = parseNdfdTimes(await response.text(), layer);
  if (times.length === 0) throw new Error(`NDFD lists no times for ${layer}`);
  return times;
}

/** HRRR frames: one small JSON per forecast hour. A few missing is fine; all missing isn't. */
export async function fetchHrrrFrames(): Promise<ForecastFrames> {
  const metas = await Promise.all(
    HRRR_MINUTES.map(async (minute) => {
      try {
        return parseHrrrMeta(minute, await getJson(hrrrMetaUrl(minute)));
      } catch {
        return null;
      }
    }),
  );
  const frames = buildHrrrFrames(metas);
  if (frames.frames.length === 0) throw new Error("IEM has no HRRR frames right now");
  return frames;
}

/** A product's frames as of `now` — uncached, for `check:sources`. */
export async function fetchForecast(id: ForecastProductId, now: number): Promise<ForecastFrames> {
  const product = forecastProduct(id);
  if (!product.ndfd) return fetchHrrrFrames();
  return buildNdfdFrames(product, pickNdfdTimes(await fetchNdfdTimes(product.ndfd.layer), now));
}

/**
 * One gzipped MRMS GRIB2 file, or null if NCEP doesn't have it — not
 * published yet (they land a minute or two after their time) or already
 * rolled off (NCEP keeps about a day).
 */
export async function fetchMrmsFile(product: MrmsProduct, time: number): Promise<Uint8Array | null> {
  try {
    const response = await get(mrmsFileUrl(product, time), "application/octet-stream, */*", 30_000);
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof UpstreamError && error.status === 404) return null;
    throw error;
  }
}

/**
 * Nominatim allows at most one request per second from a client. Requests
 * are queued and sent one at a time, a little over a second apart; a queue
 * that's already backed up rejects rather than waiting indefinitely.
 */
const GEOCODE_SPACING_MS = 1100;
const GEOCODE_MAX_QUEUE = 5;
let geocodeChain: Promise<unknown> = Promise.resolve();
let geocodeQueued = 0;
let lastGeocodeAt = 0;

export class GeocodeBusyError extends Error {
  constructor() {
    super("Too many place searches at once — try again in a moment.");
    this.name = "GeocodeBusyError";
  }
}

/** Checked before a search reaches the cache, so "busy" is never cached. */
export function geocodeQueueFull(): boolean {
  return geocodeQueued >= GEOCODE_MAX_QUEUE;
}

/**
 * Per-visitor and site-wide ceilings on place search, on top of the queue
 * above. The queue only smooths bursts; without this one visitor could send
 * a search every second all day under this server's shared Nominatim
 * identity, which Nominatim bans for. The global ceiling is a backstop if
 * many different addresses are used at once.
 */
const GEOCODE_VISITOR_WINDOW_MS = 10 * 60 * 1000;
const GEOCODE_VISITOR_MAX = 10;
const GEOCODE_GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GEOCODE_GLOBAL_MAX = 300;
const geocodeVisitorLimiter = createRateLimiterState();
const geocodeGlobalLimiter = createRateLimiterState();

/** `visitorKey` identifies the caller (their address); checked before the queue and cache. */
export function geocodeAllowed(visitorKey: string, now = Date.now()): boolean {
  const global = recordHit(geocodeGlobalLimiter, "*", now, GEOCODE_GLOBAL_WINDOW_MS, GEOCODE_GLOBAL_MAX);
  const visitor = recordHit(geocodeVisitorLimiter, visitorKey, now, GEOCODE_VISITOR_WINDOW_MS, GEOCODE_VISITOR_MAX);
  return global && visitor;
}

export function fetchGeocode(query: string): Promise<GeocodeResult[]> {
  if (geocodeQueueFull()) return Promise.reject(new GeocodeBusyError());
  geocodeQueued++;

  const run = async () => {
    const wait = lastGeocodeAt + GEOCODE_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastGeocodeAt = Date.now();
    try {
      const response = await get(nominatimUrl(query), "application/json");
      return parseNominatim(await response.json());
    } finally {
      geocodeQueued--;
    }
  };

  const result = geocodeChain.then(run, run);
  geocodeChain = result.catch(() => undefined);
  return result;
}
