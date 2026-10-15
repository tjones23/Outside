import { weightAt, type ModelRun } from "./openmeteo";
import { localParts, modelHours, previousDate, type Hourly } from "./snow-blend";
import type { BlendModelTotal, PastDay, PastSpan, SnowPast } from "./types";

/**
 * The last 15 days of snow at a spot, as the models saw it: their recent
 * past hours (Open-Meteo keeps every run's first hours) run through the same
 * rain/snow split and snow ratio as the forecast blend, and weighted as the
 * blend weights them at the start of a forecast — so a place reads the same
 * on both sides of now.
 *
 * Models aren't measurements, and a valley model cell under a ridge can
 * miss a storm; the panel puts the nearest SNOTEL's measured depth beside it.
 */

const HOUR = 3600_000;
/** Hours in each stretch the panel totals, counted back from now. */
export const PAST_PERIODS = [
  { label: "Last 5 days", from: 0, to: 120 },
  { label: "6–10 days ago", from: 120, to: 240 },
  { label: "11–15 days ago", from: 240, to: 360 },
] as const;
/** A model has to cover this share of a stretch's hours for its total to count. */
const COVERAGE = 0.9;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface ModelSum {
  key: string;
  weight: number;
  snow: number | null;
  precip: number | null;
}

/** A run's totals over the hours `idx`, or null when it misses too many of them. */
function sumOver(series: Hourly, idx: number[]): { snow: number; precip: number } | null {
  let snow = 0;
  let precip = 0;
  let have = 0;
  for (const h of idx) {
    const s = series.snow[h];
    if (s === null) continue;
    snow += s;
    precip += series.precip[h] ?? 0;
    have++;
  }
  return idx.length > 0 && have >= idx.length * COVERAGE ? { snow, precip } : null;
}

function span(sums: ModelSum[]): PastSpan & { precipIn: number | null } {
  const have = sums.filter((s): s is ModelSum & { snow: number; precip: number } => s.snow !== null);
  const weights = have.reduce((a, s) => a + s.weight, 0);
  const mean = (pick: (s: (typeof have)[number]) => number) =>
    weights > 0
      ? have.reduce((a, s) => a + s.weight * pick(s), 0) / weights
      : have.reduce((a, s) => a + pick(s), 0) / have.length;
  const snows = have.map((s) => s.snow);
  return {
    snowIn: have.length > 0 ? round1(mean((s) => s.snow)) : null,
    precipIn: have.length > 0 ? round2(mean((s) => s.precip)) : null,
    lowIn: snows.length > 0 ? round1(Math.min(...snows)) : null,
    highIn: snows.length > 0 ? round1(Math.max(...snows)) : null,
    models: have.map((s): BlendModelTotal => ({ key: s.key, snowIn: round1(s.snow) })),
  };
}

/**
 * The hindcast from whichever past runs answered. `snotel` is attached by
 * the caller; it comes from a different source on a different clock.
 */
export function buildPast(runs: ModelRun[], now: number, failed: string[] = []): Omit<SnowPast, "snotel"> {
  const { axis, timezone, elevation, models } = modelHours(runs.filter((r) => r.kind === "deterministic"));
  const nowHour = Math.floor(now / HOUR) * HOUR;
  const sumsOver = (idx: number[]): ModelSum[] =>
    models.map(({ model, series }) => {
      const s = sumOver(series[0], idx);
      return { key: model.key, weight: weightAt(model.weight, 0), snow: s?.snow ?? null, precip: s?.precip ?? null };
    });

  // Hours that have happened: an hour's value is what fell during it, so the current hour isn't in yet.
  const past = axis.flatMap((t, h) => (t < nowHour ? [h] : []));

  // 6 AM–6 AM rows, like the forecast's.
  const rows: { date: string; hours: number[] }[] = [];
  for (const h of past) {
    const { date, hour } = localParts(axis[h], timezone);
    const rowDate = hour < 6 ? previousDate(date) : date;
    const last = rows.at(-1);
    if (last && last.date === rowDate) last.hours.push(h);
    else rows.push({ date: rowDate, hours: [h] });
  }
  // The oldest row starts at midnight, not 6 AM, so it's cut short; leave it out.
  if (rows.length > 0 && localParts(axis[rows[0].hours[0]], timezone).hour !== 6) rows.shift();

  const today = rows.at(-1);
  const days: PastDay[] = rows.slice(-16).map((row) => {
    const { precipIn, ...s } = span(sumsOver(row.hours));
    return { date: row.date, partial: row === today && row.hours.length < 24, precipIn, ...s };
  });

  const periods = PAST_PERIODS.map((p) => {
    const idx = past.filter((h) => axis[h] >= nowHour - p.to * HOUR && axis[h] < nowHour - p.from * HOUR);
    // A stretch the runs don't reach back to (fewer hours than it has) has no total.
    const sums = idx.length >= (p.to - p.from) * COVERAGE ? sumsOver(idx) : [];
    const { snowIn, lowIn, highIn, models: totals } = span(sums);
    return { label: p.label, snowIn, lowIn, highIn, models: totals };
  });

  return {
    timezone,
    elevationM: elevation,
    days,
    periods,
    loaded: runs.map((r) => r.key),
    failed,
  };
}
