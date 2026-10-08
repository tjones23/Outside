import { cacheLife } from "next/cache";
import { buildNdfdFrames, forecastProduct, pickNdfdTimes } from "../forecast";
import { convectiveDate } from "../reports";
import type {
  ForecastFrames,
  ForecastProductId,
  GeocodeResult,
  OutlookData,
  OutlookProduct,
  ReportsData,
  Ring,
  StormAlert,
  StormReport,
  TropicalData,
} from "../types";
import {
  fetchAlertFeed,
  fetchGeocode,
  fetchHrrrFrames,
  fetchNdfdTimes,
  fetchOutlook,
  fetchReportDay,
  fetchTropical,
  fetchWwaOutlines,
  fetchZoneOutline,
  joinOutlines,
  UpstreamError,
  type AlertFeed,
} from "./upstream";

/**
 * The upstream feeds behind Next's `use cache`, one entry per distinct
 * argument list and a named profile each (see `next.config.ts`).
 *
 * Every browser polls on its own timer; these entries are what keep that
 * from turning into one upstream request per browser per poll.
 *
 * Failures are returned, not thrown, and cached under the short `failure`
 * profile. That makes an outage behave predictably — retried every half
 * minute, never baked in for a feed's full lifetime — without depending on
 * how the framework treats a scope that throws. Browsers keep showing the
 * last good data they have while a feed is failing.
 */

export type Fetched<T> = { ok: true; value: T } | { ok: false; error: string };

function failure(error: unknown): { ok: false; error: string } {
  cacheLife("failure");
  return { ok: false, error: error instanceof UpstreamError ? error.message : String(error) };
}

async function getAlertFeed(): Promise<Fetched<AlertFeed>> {
  "use cache";
  try {
    const value = await fetchAlertFeed();
    cacheLife("alerts");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

async function getWwaOutlines(): Promise<Fetched<Record<string, Ring[]>>> {
  "use cache";
  try {
    const value = await fetchWwaOutlines();
    cacheLife("outlines");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/** One zone's outline. Zones are redrawn once in a long while, so this is kept for days. */
async function getZoneOutline(zoneUrl: string): Promise<Fetched<Ring[]>> {
  "use cache";
  try {
    const value = await fetchZoneOutline(zoneUrl);
    cacheLife("zones");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Every active NWS alert, with outlines joined on. Not itself cached: it
 * stitches together three cached sources with different lifetimes — the
 * alert list (a minute), the map service's outlines (a few minutes) and
 * individual zones (days). Only the alert list failing is an error.
 */
export async function getAlerts(): Promise<Fetched<StormAlert[]>> {
  const [feed, outlines] = await Promise.all([getAlertFeed(), getWwaOutlines()]);
  if (!feed.ok) return feed;
  if (!outlines.ok) console.error(`[outside] alert outlines failed: ${outlines.error}`);
  const value = await joinOutlines(feed.value, outlines.ok ? outlines.value : null, async (url) => {
    const zone = await getZoneOutline(url);
    return zone.ok ? zone.value : null;
  });
  return { ok: true, value };
}

export async function getTropical(): Promise<Fetched<TropicalData>> {
  "use cache";
  try {
    const value = await fetchTropical();
    cacheLife("tropical");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

async function getHrrrFrames(): Promise<Fetched<ForecastFrames>> {
  "use cache";
  try {
    const value = await fetchHrrrFrames();
    cacheLife("forecast");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

async function getNdfdTimes(layer: string): Promise<Fetched<string[]>> {
  "use cache";
  try {
    const value = await fetchNdfdTimes(layer);
    cacheLife("forecast");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * A forecast product's frames. NDFD's are picked from its valid times here,
 * outside the cache, because which ones are still ahead depends on `now`.
 */
export async function getForecast(id: ForecastProductId, now: number): Promise<Fetched<ForecastFrames>> {
  const product = forecastProduct(id);
  if (!product.ndfd) return getHrrrFrames();
  const times = await getNdfdTimes(product.ndfd.layer);
  if (!times.ok) return times;
  return { ok: true, value: buildNdfdFrames(product, pickNdfdTimes(times.value, now)) };
}

/**
 * `date` is part of the cache key, so today's entry naturally rolls over
 * when SPC's day does, and yesterday's is a different entry from today's.
 */
async function getReportDay(date: string, isToday: boolean): Promise<Fetched<StormReport[]>> {
  "use cache";
  try {
    const value = await fetchReportDay(date, isToday);
    if (isToday) cacheLife("reportsToday");
    else cacheLife("reportsPast");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * The last `days` convective days, newest first. Not itself cached: the
 * dates depend on the current time, which must be read outside a cache scope.
 * A day that fails is reported as such rather than failing the whole request.
 */
export async function getRecentReports(days: number, now: Date): Promise<Fetched<ReportsData>> {
  const dates = Array.from({ length: days }, (_, offset) => convectiveDate(now, offset));
  const results = await Promise.all(dates.map((date, i) => getReportDay(date, i === 0)));

  const firstError = results.find((r) => !r.ok);
  if (results.every((r) => !r.ok) && firstError && !firstError.ok) {
    return { ok: false, error: firstError.error };
  }

  const reports: StormReport[] = [];
  const seen = new Set<string>();
  const summary = results.map((result, i) => {
    if (!result.ok) return { date: dates[i], ok: false, count: 0 };
    for (const report of result.value) {
      if (seen.has(report.id)) continue;
      seen.add(report.id);
      reports.push(report);
    }
    return { date: dates[i], ok: true, count: result.value.length };
  });
  return { ok: true, value: { reports, days: summary } };
}

export async function getOutlook(product: OutlookProduct): Promise<Fetched<OutlookData>> {
  "use cache";
  try {
    const value = await fetchOutlook(product);
    cacheLife("outlook");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * `query` must already be normalized, so equal searches share an entry.
 * Only successes are worth keeping for long; a failed search is retried
 * after the short failure window.
 */
export async function getGeocode(query: string): Promise<Fetched<GeocodeResult[]>> {
  "use cache";
  try {
    const value = await fetchGeocode(query);
    cacheLife("geocode");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}
