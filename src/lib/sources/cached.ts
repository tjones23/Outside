import { cacheLife } from "next/cache";
import { convectiveDate } from "../reports";
import type {
  GeocodeResult,
  OutlookData,
  OutlookProduct,
  RadarManifest,
  ReportsData,
  StormAlert,
  StormReport,
} from "../types";
import { fetchAlerts, fetchGeocode, fetchOutlook, fetchRadar, fetchReportDay, UpstreamError } from "./upstream";

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

export async function getAlerts(): Promise<Fetched<StormAlert[]>> {
  "use cache";
  try {
    const value = await fetchAlerts();
    cacheLife("alerts");
    return { ok: true, value };
  } catch (error) {
    return failure(error);
  }
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

export async function getRadar(): Promise<Fetched<RadarManifest | null>> {
  "use cache";
  try {
    const value = await fetchRadar();
    cacheLife("radar");
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
