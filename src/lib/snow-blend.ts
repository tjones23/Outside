import { BLEND_MODELS, weightAt, type BlendModel, type DeterministicRun, type ModelRun, type SurfaceSeries } from "./openmeteo";
import { columnMax, snowRatio, snowShare, standardPressure, warmestAloft, type Level } from "./snow-ratio";
import type { BlendDay, BlendModelTotal, BlendSpan, SnowBlend } from "./types";

/**
 * The snow blend: every model's precipitation turned into snow with
 * Outside's own snow ratio (`snow-ratio.ts`), then averaged with weights that
 * shift as the forecast reaches further out (`openmeteo.ts`).
 *
 * Work happens in half-days — 6 AM to 6 PM and 6 PM to 6 AM at the spot,
 * matching the NWS rows above it on the page — because models report at
 * different steps (HRRR hourly, AIFS every 6 hours), and a half-day total is
 * comparable across all of them where an hour isn't.
 *
 * The range for each day is the lowest to highest of the individual models,
 * plus each ensemble's 10th to 90th percentile: where the models disagree,
 * the range is wide, and that is the honest forecast.
 */

const HOUR = 3600_000;
const MM_PER_IN = 25.4;
/** Open-Meteo's snowfall assumes 7 cm of snow per 10 mm of water. */
const SNOW_CM_PER_MM = 0.7;

type Series = (number | null)[];

// --- Time ------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The local date and hour of `ms` at the spot. */
export function localParts(ms: number, timeZone: string): { date: string; hour: number } {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

export function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 24 * HOUR).toISOString().slice(0, 10);
}

interface Bucket {
  /** The row it belongs to: the local date its 6 AM–6 AM day starts on. */
  date: string;
  half: "day" | "night";
  /** Indexes into the shared hourly axis. */
  hours: number[];
  /** Unix ms of the middle of the half-day, for its weights. */
  mid: number;
}

/**
 * Half-days from the current hour to the end of the forecast. A last
 * half-day the forecast doesn't reach the end of is dropped: a partial total
 * would read as a small forecast.
 */
export function buildBuckets(times: number[], timeZone: string, now: number): Bucket[] {
  const buckets: Bucket[] = [];
  const nowHour = Math.floor(now / HOUR) * HOUR;
  let lastHour = -1;
  times.forEach((t, i) => {
    if (t < nowHour) return;
    const { date, hour } = localParts(t, timeZone);
    const half = hour >= 6 && hour < 18 ? "day" : "night";
    const rowDate = hour < 6 ? previousDate(date) : date;
    const last = buckets.at(-1);
    if (last && last.date === rowDate && last.half === half) last.hours.push(i);
    else buckets.push({ date: rowDate, half, hours: [i], mid: 0 });
    lastHour = hour;
  });
  if (buckets.length > 0 && lastHour !== 5 && lastHour !== 17) buckets.pop();
  for (const b of buckets) b.mid = (times[b.hours[0]] + times[b.hours.at(-1)!] + HOUR) / 2;
  return buckets;
}

// --- Hourly snow, per run ----------------------------------------------------------

/** One run (or ensemble member) as inches per hour on the shared axis. */
export interface Hourly {
  snow: Series;
  swe: Series;
  precip: Series;
  tempC: Series;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function levelsAt(run: DeterministicRun, i: number): Level[] {
  const out: Level[] = [];
  for (const l of run.levels) {
    const t = l.tempC[i];
    if (t !== null) out.push({ hPa: l.hPa, tempC: t });
  }
  return out;
}

function surfaceAt(run: DeterministicRun, i: number): number {
  return run.surfaceHPa[i] ?? standardPressure(run.elevation ?? 0);
}

/**
 * The models' consensus column, hour by hour: the median warmest level and
 * warmest layer aloft among models that have levels. Models without levels
 * (NBM, the ensembles here) borrow it, which beats guessing from 2 m alone.
 */
function consensusColumn(runs: DeterministicRun[], index: Map<number, number>[], axis: number[]) {
  const col: Series = [];
  const aloft: Series = [];
  axis.forEach((t, h) => {
    const cols: number[] = [];
    const alofts: number[] = [];
    runs.forEach((run, r) => {
      const i = index[r].get(t);
      if (i === undefined) return;
      const levels = levelsAt(run, i);
      const surface = surfaceAt(run, i);
      const c = columnMax(levels, surface, run.tempC[i]);
      const a = warmestAloft(levels, surface);
      if (c !== null) cols.push(c);
      if (a !== null) alofts.push(a);
    });
    col[h] = median(cols);
    aloft[h] = median(alofts);
  });
  return { col, aloft };
}

/** Snow from one hour of one run. */
function hourSnow(
  s: SurfaceSeries,
  i: number,
  column: { col: number | null; aloft: number | null },
): { snow: number; swe: number; precip: number } | null {
  const precipMm = s.precipMm[i];
  if (precipMm === null) return null;
  const tempC = s.tempC[i];
  const snowCm = s.snowfallCm[i];
  const modelShare = snowCm !== null && precipMm > 0 ? Math.min(1, snowCm / SNOW_CM_PER_MM / precipMm) : null;
  const share = precipMm > 0 ? snowShare({ tempC, rh: s.rh[i], warmestAloftC: column.aloft, modelShare }) : 0;
  const colMax = column.col !== null ? Math.max(column.col, tempC ?? -Infinity) : tempC;
  const ratio = colMax !== null ? snowRatio(colMax, s.windMs[i]) : 10;
  const sweMm = precipMm * share;
  return { snow: (sweMm * ratio) / MM_PER_IN, swe: sweMm / MM_PER_IN, precip: precipMm / MM_PER_IN };
}

function hourly(
  s: SurfaceSeries,
  index: Map<number, number>,
  axis: number[],
  column: (h: number, i: number) => { col: number | null; aloft: number | null },
): Hourly {
  const out: Hourly = { snow: [], swe: [], precip: [], tempC: [] };
  axis.forEach((t, h) => {
    const i = index.get(t);
    const r = i === undefined ? null : hourSnow(s, i, column(h, i));
    out.snow[h] = r?.snow ?? null;
    out.swe[h] = r?.swe ?? null;
    out.precip[h] = r?.precip ?? null;
    out.tempC[h] = i === undefined ? null : s.tempC[i];
  });
  return out;
}

// --- Half-day totals ---------------------------------------------------------------

/**
 * A run's total over a half-day, or null unless it covers it. Six-hourly
 * models may leave hours between their steps empty, so a gap of up to five
 * hours at either end still counts as covered; missing hours count as zero.
 */
function bucketTotal(series: Series, b: Bucket, span: { first: number; last: number } | null): number | null {
  if (!span) return null;
  if (span.first > b.hours[0] + 5 || span.last < b.hours.at(-1)! - 5) return null;
  let total = 0;
  let any = false;
  for (const h of b.hours) {
    const v = series[h];
    if (v !== null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function dataSpan(series: Series): { first: number; last: number } | null {
  const first = series.findIndex((v) => v !== null);
  if (first < 0) return null;
  let last = series.length - 1;
  while (series[last] === null) last--;
  return { first, last };
}

/** Per model, per half-day: totals of snow, water and precipitation. */
interface ModelBuckets {
  model: BlendModel;
  /** One entry for a deterministic model, one per member for an ensemble. */
  snow: (number | null)[][];
  swe: (number | null)[][];
  precip: (number | null)[][];
  /** Deterministic only: [max, min] °C in each half-day. */
  temp: ([number, number] | null)[];
}

function totals(runs: Hourly[], buckets: Bucket[]) {
  const pick = (key: "snow" | "swe" | "precip") =>
    runs.map((r) => {
      const span = dataSpan(r[key]);
      return buckets.map((b) => bucketTotal(r[key], b, span));
    });
  return { snow: pick("snow"), swe: pick("swe"), precip: pick("precip") };
}

function tempRange(run: Hourly, b: Bucket): [number, number] | null {
  const temps = b.hours.map((h) => run.tempC[h]).filter((t): t is number => t !== null);
  return temps.length === 0 ? null : [Math.max(...temps), Math.min(...temps)];
}

// --- Blending ------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const x = (sorted.length - 1) * p;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

/** Members that cover every half-day in `idx`, each summed. Null unless at least half the members do. */
function memberSums(values: (number | null)[][], idx: number[]): number[] | null {
  const sums: number[] = [];
  for (const member of values) {
    let total = 0;
    let ok = true;
    for (const b of idx) {
      const v = member[b];
      if (v === null) {
        ok = false;
        break;
      }
      total += v;
    }
    if (ok) sums.push(total);
  }
  return sums.length > 0 && sums.length * 2 >= values.length ? sums : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Each model's (or ensemble's mean) value per half-day, and its weight there. */
function blendBucket(models: ModelBuckets[], key: "snow" | "swe" | "precip", b: number, leadHours: number): number | null {
  let sum = 0;
  let weights = 0;
  let plain = 0;
  let count = 0;
  for (const m of models) {
    const sums = memberSums(m[key], [b]);
    if (!sums) continue;
    const value = sums.reduce((a, c) => a + c, 0) / sums.length;
    const w = weightAt(m.model.weight, leadHours);
    sum += w * value;
    weights += w;
    plain += value;
    count++;
  }
  if (count === 0) return null;
  // Only zero-weight models left (ensembles before day 5 with nothing else): a plain mean beats nothing.
  return weights > 0 ? sum / weights : plain / count;
}

function blendTemp(models: ModelBuckets[], b: number, leadHours: number, which: 0 | 1): number | null {
  let sum = 0;
  let weights = 0;
  for (const m of models) {
    const t = m.temp[b];
    if (!t) continue;
    const w = weightAt(m.model.weight, leadHours);
    sum += w * t[which];
    weights += w;
  }
  return weights > 0 ? sum / weights : null;
}

const toF = (c: number | null) => (c === null ? null : Math.round((c * 9) / 5 + 32));

/** The models' totals over some half-days, and the range they span. */
function span(models: ModelBuckets[], idx: number[], blended: (number | null)[]): BlendSpan {
  const parts = idx.map((b) => blended[b]);
  const snowIn = parts.every((p) => p !== null) ? round1((parts as number[]).reduce((a, c) => a + c, 0)) : null;
  const totalsOut: BlendModelTotal[] = [];
  const ends: number[] = [];
  for (const m of models) {
    const sums = memberSums(m.snow, idx);
    if (!sums) continue;
    if (m.model.kind === "deterministic") {
      totalsOut.push({ key: m.model.key, snowIn: round1(sums[0]) });
      ends.push(sums[0]);
    } else {
      const sorted = [...sums].sort((a, b) => a - b);
      const p10 = percentile(sorted, 0.1);
      const p90 = percentile(sorted, 0.9);
      const mean = sums.reduce((a, c) => a + c, 0) / sums.length;
      totalsOut.push({ key: m.model.key, snowIn: round1(mean), p10In: round1(p10), p90In: round1(p90), members: sums.length });
      ends.push(p10, p90);
    }
  }
  return {
    snowIn,
    lowIn: ends.length > 0 ? round1(Math.min(...ends)) : null,
    highIn: ends.length > 0 ? round1(Math.max(...ends)) : null,
    models: totalsOut,
  };
}

/** Every run's hourly snow on the reference run's hour axis. */
export interface ModelHours {
  axis: number[];
  timezone: string;
  elevation: number | null;
  /** One series for a deterministic model, one per member for an ensemble. */
  models: { model: BlendModel; series: Hourly[] }[];
}

/**
 * Each run's precipitation turned into snow hour by hour, with its own
 * column where it has upper-air temperatures and the models' consensus
 * where it doesn't. `runs` must all be for the same spot; at least one is
 * needed.
 */
export function modelHours(runs: ModelRun[]): ModelHours {
  const reference = runs.find((r) => r.kind === "deterministic") ?? runs[0];
  if (!reference) throw new Error("no model answered");
  const axis = reference.times;
  const indexOf = (times: number[]) => new Map(times.map((t, i) => [t, i]));

  const deterministic = runs.filter((r): r is DeterministicRun => r.kind === "deterministic");
  const detIndex = deterministic.map((r) => indexOf(r.times));
  const consensus = consensusColumn(deterministic, detIndex, axis);
  const fromConsensus = (h: number) => ({ col: consensus.col[h], aloft: consensus.aloft[h] });
  const byKey = new Map(BLEND_MODELS.map((m) => [m.key, m]));

  const models: ModelHours["models"] = [];
  for (const run of runs) {
    const model = byKey.get(run.key);
    if (!model) continue;
    const index = indexOf(run.times);
    if (run.kind === "deterministic") {
      const own = (h: number, i: number) => {
        const levels = levelsAt(run, i);
        const surface = surfaceAt(run, i);
        const col = columnMax(levels, surface, run.tempC[i]);
        const aloft = warmestAloft(levels, surface);
        return { col: col ?? consensus.col[h], aloft: col !== null ? aloft : consensus.aloft[h] };
      };
      models.push({ model, series: [hourly(run, index, axis, own)] });
    } else {
      models.push({ model, series: run.members.map((member) => hourly(member, index, axis, fromConsensus)) });
    }
  }
  return { axis, timezone: reference.timezone, elevation: reference.elevation, models };
}

/**
 * The blend for a spot from whichever models answered. `runs` must all be
 * for the same spot; at least one is needed.
 */
export function buildBlend(runs: ModelRun[], now: number, failed: string[] = []): SnowBlend {
  const { axis, timezone, elevation, models: hours } = modelHours(runs);
  const buckets = buildBuckets(axis, timezone, now);
  const models: ModelBuckets[] = hours.map(({ model, series }) => ({
    model,
    ...totals(series, buckets),
    temp: model.kind === "deterministic" ? buckets.map((b) => tempRange(series[0], b)) : buckets.map(() => null),
  }));

  const lead = (b: Bucket) => Math.max(0, (b.mid - now) / HOUR);
  const blendOf = (key: "snow" | "swe" | "precip") => buckets.map((b, i) => blendBucket(models, key, i, lead(b)));
  const snow = blendOf("snow");
  const swe = blendOf("swe");
  const precip = blendOf("precip");

  // Rows: a day half-day and the night after it; the first may be a night alone.
  const rows: number[][] = [];
  buckets.forEach((b, i) => {
    const last = rows.at(-1);
    if (last && buckets[last[0]].date === b.date) last.push(i);
    else rows.push([i]);
  });

  const sumOf = (values: (number | null)[], idx: number[]) => {
    const parts = idx.map((b) => values[b]);
    return parts.every((p) => p !== null) ? (parts as number[]).reduce((a, c) => a + c, 0) : null;
  };

  const days: BlendDay[] = rows.map((idx) => {
    const dayB = idx.find((b) => buckets[b].half === "day");
    const nightB = idx.find((b) => buckets[b].half === "night");
    const s = span(models, idx, snow);
    const w = sumOf(swe, idx);
    return {
      date: buckets[idx[0]].date,
      nightOnly: dayB === undefined,
      ...s,
      dayIn: dayB === undefined || snow[dayB] === null ? null : round1(snow[dayB]!),
      nightIn: nightB === undefined || snow[nightB] === null ? null : round1(snow[nightB]!),
      precipIn: (() => {
        const p = sumOf(precip, idx);
        return p === null ? null : round2(p);
      })(),
      ratio: s.snowIn !== null && w !== null && w >= 0.02 ? Math.round(s.snowIn / w) : null,
      high: dayB === undefined ? null : toF(blendTemp(models, dayB, lead(buckets[dayB]), 0)),
      low: nightB === undefined ? null : toF(blendTemp(models, nightB, lead(buckets[nightB]), 1)),
    };
  });

  const periods = [
    { label: "Next 5 days", from: 0, to: 5 },
    { label: "Days 6–10", from: 5, to: 10 },
    { label: "Days 11–15", from: 10, to: 15 },
  ]
    .filter((p) => rows.length >= p.to)
    .map((p) => ({ label: p.label, ...span(models, rows.slice(p.from, p.to).flat(), snow) }));

  return {
    timezone,
    elevationM: elevation,
    days: days.slice(0, 15),
    periods,
    loaded: runs.map((r) => r.key),
    failed,
  };
}
