import { NWS_ALERTS_URL, parseNwsAlerts } from "../alerts";
import { nominatimUrl, parseNominatim } from "../geocode";
import { buildOutlook } from "../outlook";
import { parseRadarManifest, RAINVIEWER_MANIFEST_URL } from "../radar";
import { parseSpcCsv, reportsUrl } from "../reports";
import type {
  GeocodeResult,
  OutlookData,
  OutlookProduct,
  RadarManifest,
  StormAlert,
  StormReport,
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

async function get(url: string, accept: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": userAgent(), Accept: accept },
      signal: AbortSignal.timeout(TIMEOUT_MS),
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

export async function fetchAlerts(): Promise<StormAlert[]> {
  const response = await get(NWS_ALERTS_URL, "application/geo+json");
  return parseNwsAlerts(await response.json());
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

export async function fetchRadar(): Promise<RadarManifest | null> {
  const response = await get(RAINVIEWER_MANIFEST_URL, "application/json");
  return parseRadarManifest(await response.json());
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
