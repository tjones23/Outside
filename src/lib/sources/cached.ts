import { cacheLife } from "next/cache";
import { airNowHour, hourIso } from "../air-quality";
import { buildNdfdFrames, forecastProduct, pickNdfdTimes } from "../forecast";
import { BLEND_MODELS, type ModelRun } from "../openmeteo";
import { buildDays, type GridAmounts, type PeriodForecast, type PointInfo } from "../point-forecast";
import { buildBlend } from "../snow-blend";
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
  PointForecast,
  ReportsData,
  SnowBlend,
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
  fetchGridAmounts,
  fetchHotspots,
  fetchHrrrFrames,
  fetchModelRun,
  fetchNdfdTimes,
  fetchOutlook,
  fetchPeriods,
  fetchPoint,
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

/** Which grid cell covers a spot. `lat`/`lon` must already be rounded, so repeats share an entry. */
async function getPoint(lat: number, lon: number): Promise<Fetched<PointInfo>> {
  "use cache";
  try {
    const value = await fetchPoint(lat, lon);
    cacheLife("points");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

async function getPeriods(forecastUrl: string): Promise<Fetched<PeriodForecast>> {
  "use cache";
  try {
    const value = await fetchPeriods(forecastUrl);
    cacheLife("pointForecast");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

async function getGridAmounts(gridUrl: string): Promise<Fetched<GridAmounts>> {
  "use cache";
  try {
    const value = await fetchGridAmounts(gridUrl);
    cacheLife("pointForecast");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * A spot's 7-day forecast. Not itself cached: rows are cut at `now`, and
 * the grid cell, the wording and the amounts each have their own entry.
 * Only the wording failing is an error; without the grid the rows still
 * show, just without snow and precipitation amounts.
 */
export async function getPointForecast(lat: number, lon: number, now: number): Promise<Fetched<PointForecast>> {
  const point = await getPoint(lat, lon);
  if (!point.ok) return point;
  const [periods, grid] = await Promise.all([getPeriods(point.value.forecastUrl), getGridAmounts(point.value.gridUrl)]);
  if (!periods.ok) return periods;
  if (!grid.ok) console.error(`[outside] forecast grid failed: ${grid.error}`);
  return {
    ok: true,
    value: {
      place: point.value.place,
      updated: periods.value.updated,
      days: buildDays(periods.value, grid.ok ? grid.value : null, now),
      amountsMissing: !grid.ok,
    },
  };
}

/** Keep each model's run about as long as the model takes to run again. */
function cacheModelRun(key: string): void {
  const model = BLEND_MODELS.find((m) => m.key === key);
  if (model?.kind === "ensemble") cacheLife("modelsEnsemble");
  else if (key === "hrrr" || key === "hrdps" || key === "nbm") cacheLife("modelsHourly");
  else cacheLife("modelsGlobal");
}

/** One model's run for a spot. `lat`/`lon` must already be rounded. */
async function getModelRun(key: string, lat: number, lon: number): Promise<Fetched<ModelRun>> {
  "use cache";
  try {
    const model = BLEND_MODELS.find((m) => m.key === key);
    if (!model) throw new Error(`unknown model ${key}`);
    const value = await fetchModelRun(model, lat, lon);
    cacheModelRun(key);
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
}

/**
 * A spot's snow blend. Not itself cached: the half-days are cut at `now`,
 * and each model has its own entry. Models that fail are left out and
 * named; only every model failing is an error.
 */
export async function getSnowBlend(lat: number, lon: number, now: number): Promise<Fetched<SnowBlend>> {
  const results = await Promise.all(BLEND_MODELS.map((m) => getModelRun(m.key, lat, lon)));
  const runs = results.flatMap((r) => (r.ok ? [r.value] : []));
  const failed = BLEND_MODELS.filter((_, i) => !results[i].ok).map((m) => m.key);
  if (runs.length === 0) return results[0] as Fetched<SnowBlend>;
  for (const key of failed) {
    const r = results[BLEND_MODELS.findIndex((m) => m.key === key)];
    if (!r.ok) console.error(`[outside] ${key} run failed: ${r.error}`);
  }
  return { ok: true, value: buildBlend(runs, now, failed) };
}
