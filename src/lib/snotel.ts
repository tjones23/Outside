import { distanceMiles } from "./geo";

/**
 * Measured snow from USDA NRCS SNOTEL: about 900 automated stations in the
 * western mountains, each with a snow depth sensor and a snow pillow that
 * weighs the snowpack's water. Many sit on or beside ski areas (Atwater is
 * at Alta), which makes the nearest one the best free, public stand-in for a
 * resort's own reported base — resorts publish theirs only through paid
 * feeds.
 *
 * Read through NRCS's AWDB REST API, which is free and keyless.
 */

const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

/** A station counts as "near" within this many miles. */
export const SNOTEL_RADIUS_MILES = 20;
/** Each 1,000 ft of height difference counts as this many miles of distance when picking one. */
const MILES_PER_1000_FT = 2;

export interface SnotelStation {
  /** AWDB's triplet, "1308:UT:SNTL". */
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number;
  /** Hours from UTC of the station's clock (standard time, all year). */
  utcOffset: number;
}

/** A station's latest depth, for lists. */
export interface SnotelDepth extends SnotelStation {
  depthIn: number;
  /** Unix ms of the newest reading used. */
  at: number;
}

export interface SnotelDay {
  /**
   * The station-local date. AWDB's daily value for a date is the reading at
   * the midnight that ends it, so `newIn` is what fell during that day.
   */
  date: string;
  depthIn: number | null;
  sweIn: number | null;
  /** Depth gained over the day, when it was new snow (see `newSnow`). */
  newIn: number | null;
  /** Today, from the latest hourly readings. */
  partial?: boolean;
}

/** The `/api/snow-past` station block. */
export interface SnotelReport {
  station: SnotelStation;
  miles: number;
  /** Now, from the newest hourly readings. */
  depthIn: number | null;
  sweIn: number | null;
  at: number | null;
  /** Oldest first: 15 whole days, then today's so far. */
  days: SnotelDay[];
  /** "Last 5 days", "6–10 days ago", "11–15 days ago". */
  periods: { label: string; newIn: number | null; sweGainIn: number | null }[];
}

export function stationsUrl(): string {
  return `${AWDB}/stations?${new URLSearchParams({
    stationTriplets: "*:*:SNTL",
    returnForecastPointMetadata: "false",
    returnReservoirMetadata: "false",
    returnStationElements: "false",
    activeOnly: "true",
  })}`;
}

/** AWDB dates are station-local; this is wide enough to cover every US zone. */
function awdbTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Hourly depth at every station in a state over the last several hours.
 * AWDB is slow to answer a request for every station at once (half a
 * minute); one per state, side by side, takes a few seconds.
 */
export function latestDepthsUrl(state: string, now: number): string {
  return `${AWDB}/data?${new URLSearchParams({
    stationTriplets: `*:${state}:SNTL`,
    elements: "SNWD",
    duration: "HOURLY",
    // Station clocks run 7–9 hours behind UTC, so this is the last 7–9 hours of readings.
    beginDate: awdbTime(now - 16 * 3600_000),
    endDate: awdbTime(now + 3600_000),
  })}`;
}

export function stationDataUrl(id: string, duration: "DAILY" | "HOURLY", now: number): string {
  const days = duration === "DAILY" ? 17 : 1;
  return `${AWDB}/data?${new URLSearchParams({
    stationTriplets: id,
    elements: "SNWD,WTEQ",
    duration,
    beginDate: duration === "DAILY" ? awdbTime(now - days * 86400_000).slice(0, 10) : awdbTime(now - 20 * 3600_000),
    endDate: duration === "DAILY" ? awdbTime(now + 86400_000).slice(0, 10) : awdbTime(now + 14 * 3600_000),
  })}`;
}

const TRIPLET = /^\d{3,5}:[A-Z]{2}:SNTL$/;

export function isStationId(id: string): boolean {
  return TRIPLET.test(id);
}

export function parseStations(json: unknown): SnotelStation[] {
  if (!Array.isArray(json)) throw new Error("AWDB answered without a station list");
  return json.flatMap((s): SnotelStation[] => {
    const r = s as Record<string, unknown>;
    const id = r.stationTriplet;
    if (typeof id !== "string" || !isStationId(id)) return [];
    if (typeof r.latitude !== "number" || typeof r.longitude !== "number") return [];
    return [
      {
        id,
        name: typeof r.name === "string" ? r.name : id,
        lat: r.latitude,
        lon: r.longitude,
        elevationFt: typeof r.elevation === "number" ? Math.round(r.elevation) : 0,
        utcOffset: typeof r.dataTimeZone === "number" ? r.dataTimeZone : -8,
      },
    ];
  });
}

/** One station's readings, by element code, each as [station-local date string, value]. */
export type StationSeries = Map<string, [string, number][]>;

/** AWDB's data answer as station id → element → readings, nulls dropped. */
export function parseData(json: unknown): Map<string, StationSeries> {
  if (!Array.isArray(json)) throw new Error("AWDB answered without data");
  const out = new Map<string, StationSeries>();
  for (const s of json) {
    const r = s as { stationTriplet?: unknown; data?: unknown };
    if (typeof r.stationTriplet !== "string" || !Array.isArray(r.data)) continue;
    const series: StationSeries = new Map();
    for (const d of r.data as { stationElement?: { elementCode?: unknown }; values?: unknown }[]) {
      const code = d.stationElement?.elementCode;
      if (typeof code !== "string" || !Array.isArray(d.values)) continue;
      const values = (d.values as { date?: unknown; value?: unknown }[]).flatMap((v): [string, number][] =>
        typeof v.date === "string" && typeof v.value === "number" && Number.isFinite(v.value) ? [[v.date, v.value]] : [],
      );
      series.set(code, values);
    }
    out.set(r.stationTriplet, series);
  }
  return out;
}

/** "2026-10-14 15:00" at a station's offset → Unix ms. */
export function stationTime(local: string, utcOffset: number): number {
  return Date.parse(`${local.replace(" ", "T")}${local.length === 10 ? "T00:00" : ""}:00Z`) - utcOffset * 3600_000;
}

/**
 * Depth sensors read a fresh value every hour and jitter by an inch or two
 * as the snow settles and the sound bounces off new flakes. The median of the
 * last three readings is steadier than the last one alone.
 */
export function latestOf(readings: [string, number][], utcOffset: number): { value: number; at: number } | null {
  const last = readings.slice(-3).map(([, v]) => v);
  if (last.length === 0) return null;
  const sorted = [...last].sort((a, b) => a - b);
  // Depth can't be negative; a negative reading is a sensor that's reset over bare ground.
  return { value: Math.max(0, sorted[sorted.length >> 1]), at: stationTime(readings.at(-1)![0], utcOffset) };
}

export function buildDepths(stations: SnotelStation[], data: Map<string, StationSeries>): SnotelDepth[] {
  return stations.flatMap((s) => {
    const latest = latestOf(data.get(s.id)?.get("SNWD") ?? [], s.utcOffset);
    return latest ? [{ ...s, depthIn: latest.value, at: latest.at }] : [];
  });
}

/**
 * The station to show for a spot: the nearest within `SNOTEL_RADIUS_MILES`,
 * with each 1,000 ft of height difference counting as two miles when the
 * spot's height is known — a station at the resort's mid-mountain beats a
 * slightly closer one down in the valley.
 */
export function nearestStation<T extends SnotelStation>(
  stations: T[],
  lat: number,
  lon: number,
  elevationFt: number | null,
): { station: T; miles: number } | null {
  let best: { station: T; miles: number; score: number } | null = null;
  for (const station of stations) {
    if (Math.abs(station.lat - lat) > 0.5 || Math.abs(station.lon - lon) > 0.7) continue;
    const miles = distanceMiles([lat, lon], [station.lat, station.lon]);
    if (miles > SNOTEL_RADIUS_MILES) continue;
    const climb = elevationFt === null ? 0 : (Math.abs(station.elevationFt - elevationFt) / 1000) * MILES_PER_1000_FT;
    const score = miles + climb;
    if (!best || score < best.score) best = { station, miles, score };
  }
  return best && { station: best.station, miles: best.miles };
}

/**
 * New snow from one midnight's depth to the next. Settling, wind and sensor
 * jitter move the depth by an inch or so without any snow, so a rise counts
 * only when the snow pillow gained water too (≥ 0.1″) or the rise is big
 * enough (≥ 3″) not to be noise. It still undercounts: snow that falls and
 * settles in the same day shows only as its settled depth.
 */
export function newSnow(depthBefore: number | null, depthAfter: number | null, sweBefore: number | null, sweAfter: number | null): number | null {
  if (depthBefore === null || depthAfter === null) return null;
  const rise = depthAfter - depthBefore;
  if (rise <= 0) return 0;
  const sweGain = sweBefore !== null && sweAfter !== null ? sweAfter - sweBefore : null;
  return (sweGain !== null && sweGain >= 0.1) || rise >= 3 ? rise : 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A station's report: today's depth, the last 15 days' closing readings
 * with the new snow each day, and new snow over the same three stretches
 * as the model hindcast.
 */
export function buildReport(
  station: SnotelStation,
  miles: number,
  daily: StationSeries | undefined,
  hourly: StationSeries | undefined,
): SnotelReport {
  const depth = new Map(daily?.get("SNWD") ?? []);
  const swe = new Map(daily?.get("WTEQ") ?? []);
  const dates = [...new Set([...depth.keys(), ...swe.keys()])].sort();
  const latestDepth = latestOf(hourly?.get("SNWD") ?? [], station.utcOffset);
  const latestSwe = latestOf(hourly?.get("WTEQ") ?? [], station.utcOffset);

  const days: SnotelDay[] = dates.map((date, i) => {
    const prev = dates[i - 1];
    return {
      date,
      depthIn: depth.get(date) ?? null,
      sweIn: swe.get(date) ?? null,
      newIn:
        prev === undefined
          ? null
          : newSnow(depth.get(prev) ?? null, depth.get(date) ?? null, swe.get(prev) ?? null, swe.get(date) ?? null),
    };
  });
  // Snow since the last midnight reading: today's row, still going.
  const lastDay = days.at(-1);
  const hourlyDepth = hourly?.get("SNWD") ?? [];
  const todayDate = hourlyDepth.at(-1)?.[0].slice(0, 10);
  const today: SnotelDay | null =
    lastDay && latestDepth && todayDate && todayDate > lastDay.date
      ? {
          date: todayDate,
          depthIn: latestDepth.value,
          sweIn: latestSwe?.value ?? null,
          newIn: newSnow(lastDay.depthIn, latestDepth.value, lastDay.sweIn, latestSwe?.value ?? null),
          partial: true,
        }
      : null;

  const recent = days.slice(-15);
  // Five whole days each, counted back from the last midnight; the latest also gets today's.
  const stretch = (from: number, to: number) => {
    const part = recent.slice(Math.max(0, recent.length - to), recent.length - from);
    if (part.length < to - from || part.some((d) => d.newIn === null)) return { newIn: null, sweGainIn: null };
    const last = from === 0 && today ? today : part.at(-1)!;
    const total = part.reduce((a, d) => a + d.newIn!, 0) + (last === today ? (today.newIn ?? 0) : 0);
    const before = days[days.length - to - 1]?.sweIn ?? null;
    return { newIn: round1(total), sweGainIn: before !== null && last.sweIn !== null ? round1(last.sweIn - before) : null };
  };

  return {
    station,
    miles: round1(miles),
    depthIn: latestDepth?.value ?? lastDay?.depthIn ?? null,
    sweIn: latestSwe?.value ?? lastDay?.sweIn ?? null,
    at: latestDepth?.at ?? null,
    days: today ? [...recent, today] : recent,
    periods: [
      { label: "Last 5 days", ...stretch(0, 5) },
      { label: "6–10 days ago", ...stretch(5, 10) },
      { label: "11–15 days ago", ...stretch(10, 15) },
    ],
  };
}
