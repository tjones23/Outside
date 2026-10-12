import { cacheLife } from "next/cache";
import { airNowHour, hourIso } from "../air-quality";
import { buildNdfdFrames, forecastProduct, pickNdfdTimes } from "../forecast";
import { convectiveDate } from "../reports";
import { utcDate } from "../smoke";
import type {
  AirQualityData,
  AirQualitySite,
  ForecastFrames,
  ForecastProductId,
  GeocodeResult,
  Hotspot,
  OutlookData,
  OutlookProduct,
  ReportsData,
  Ring,
  SmokeData,
  StormAlert,
  StormReport,
  TropicalData,
  WildfireData,
  WildfireIncident,
  WildfirePerimeter,
} from "../types";
import {
  AIRNOW_LOOKBACK_HOURS,
  fetchAirNowHour,
  fetchAlertFeed,
  fetchFireIncidents,
  fetchFirePerimeters,
  fetchGeocode,
  fetchHotspots,
  fetchHrrrFrames,
  fetchNdfdTimes,
  fetchOutlook,
  fetchReportDay,
  fetchSmokeDay,
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

async function getFireIncidents(): Promise<Fetched<WildfireIncident[]>> {
  "use cache";
  try {
    const value = await fetchFireIncidents();
    cacheLife("fires");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

async function getFirePerimeters(): Promise<Fetched<WildfirePerimeter[]>> {
  "use cache";
  try {
    const value = await fetchFirePerimeters();
    cacheLife("perimeters");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Wildfires with their perimeters. Not itself cached: incidents change
 * through the day, perimeters mostly once a day after the night's mapping
 * flights, so each has its own entry. Only incidents failing is an error.
 */
export async function getFires(): Promise<Fetched<WildfireData>> {
  const [incidents, perimeters] = await Promise.all([getFireIncidents(), getFirePerimeters()]);
  if (!incidents.ok) return incidents;
  if (!perimeters.ok) console.error(`[outside] fire perimeters failed: ${perimeters.error}`);
  return {
    ok: true,
    value: {
      incidents: incidents.value,
      perimeters: perimeters.ok ? perimeters.value : [],
      perimetersMissing: !perimeters.ok,
    },
  };
}

export async function getHotspots(): Promise<Fetched<Hotspot[]>> {
  "use cache";
  try {
    const value = await fetchHotspots();
    cacheLife("hotspots");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/** One UTC day's smoke; `date` is the key, so each day is its own entry. */
async function getSmokeDay(date: string): Promise<Fetched<SmokeData | null>> {
  "use cache";
  try {
    const value = await fetchSmokeDay(date);
    cacheLife("smoke");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Today's smoke, or yesterday's until today's has plumes. Not itself
 * cached: which day is "today" must be read outside a cache scope.
 */
export async function getSmoke(now: Date): Promise<Fetched<SmokeData>> {
  const todayDate = utcDate(now);
  const today = await getSmokeDay(todayDate);
  if (!today.ok) return today;
  if (today.value && today.value.plumes.length > 0) return { ok: true, value: today.value };
  const yesterday = await getSmokeDay(utcDate(now, 1));
  if (yesterday.ok && yesterday.value) return { ok: true, value: yesterday.value };
  return { ok: true, value: today.value ?? { date: todayDate, plumes: [] } };
}

/**
 * One hour's AirNow file; `hour` is the key. An hour that isn't published
 * yet is remembered only briefly, so it's picked up soon after it lands.
 */
async function getAirNowHour(hour: string): Promise<Fetched<AirQualitySite[] | null>> {
  "use cache";
  try {
    const value = await fetchAirNowHour(hour);
    if (value) cacheLife("airQuality");
    else cacheLife("failure");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * The newest published hour of air quality. Not itself cached: which hours
 * are recent must be read outside a cache scope.
 */
export async function getAirQuality(now: Date): Promise<Fetched<AirQualityData>> {
  for (let ago = 1; ago <= AIRNOW_LOOKBACK_HOURS; ago++) {
    const hour = airNowHour(now, ago);
    const result = await getAirNowHour(hour);
    if (!result.ok) return result;
    if (result.value) return { ok: true, value: { hour: hourIso(hour), sites: result.value } };
  }
  return { ok: false, error: `AirNow has no observations for the last ${AIRNOW_LOOKBACK_HOURS} hours` };
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
