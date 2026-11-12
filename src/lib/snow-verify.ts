import { BLEND_MODELS, VERIFY_DAYS, VERIFY_LEADS, weightAt, type PreviousRuns, type VerifyLead } from "./openmeteo";
import { stationTime, type SnotelStation } from "./snotel";
import type { BlendVerification, VerifiedModel, VerifiedStation } from "./types";

/**
 * How the models have been doing at a spot, and what to do about it.
 *
 * Each model's forecasts from one, three and five days before each of the
 * last 30 days (Open-Meteo's previous runs) are checked against the water
 * that nearby SNOTEL gauges measured on those days. Water rather than snow
 * depth: a gauge's water is measured directly, while depth settles and
 * blows around, and the blend's snow ratio is worked out from temperatures
 * separately anyway. Two things are learned:
 *
 * 1. **A precipitation correction per model**, at the spot's height. Models
 *    see smoothed terrain — GFS's mountains are 13 km wide and thousands of
 *    feet lower than the real peaks — so they underdo the extra snow ridges
 *    wring out of a storm, by an amount that grows with height. Each model's
 *    ratio of measured to forecast water at each gauge is fitted as
 *
 *        ln(measured / forecast) = a[model] + g × (gauge height − spot height) / 1,000 ft
 *
 *    so `a` is the model's correction at the spot's own height, and `g`
 *    — shared by every model, since it's the mountain's doing, not theirs —
 *    is how much faster than the models precipitation grows with height.
 *    With gauges at a few heights the data pins `g` down; with one, `g`
 *    stays near a modest prior and `a` alone does the work. Both are pulled
 *    toward "no correction" in proportion to how little water there was to
 *    learn from, so a dry month changes nothing.
 * 2. **A weight per model and lead time.** After correction, each model's
 *    average daily miss is compared with the median model's at the same
 *    lead; one that has been missing by half as much counts up to twice as
 *    much in the blend, shrunk toward no change when it has few wet days.
 *
 * Learning is from a rolling window, so it follows the season: what was
 * true in a wet October storm cycle fades out by December. Model weights
 * aren't learned past five days ahead (nothing is verified out there), so
 * they fade back to the starting weights by day 10.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const LN2 = Math.log(2);

/** A day counts when the gauge or the model had at least this much water, inches. */
const WET_IN = 0.05;
/** A day's model total counts only with this many of its 24 hours. */
const MIN_HOURS = 20;
/** Water, inches per lead, at a gauge for its ratio to count fully; less counts for less. */
const FULL_WEIGHT_IN = 2;
/** Added to both sides of a ratio so a trace against nothing isn't infinite. */
const RATIO_PAD_IN = 0.1;

/**
 * The prior on `g`: models already see some of the mountain, so the extra
 * gain with height beyond theirs is modest — about 8% more per 1,000 ft.
 * Measured gradients in the Wasatch or Sierra run several times that, but
 * much of it is in the models already.
 */
export const PRIOR_GRADIENT = 0.08;
/** How firmly the priors hold: as if this many full-weight gauges agreed with them. */
const INTERCEPT_PRIOR = 0.5;
const GRADIENT_PRIOR = 2;
/** Corrections are kept within a third to three times the forecast. */
const MAX_LOG_CORRECTION = Math.log(3);
const GRADIENT_RANGE: [number, number] = [-0.1, 0.4];

/** Wet days at which a model's weight change is half-trusted. */
const WEIGHT_HALF_DAYS = 6;
/** A model needs this many wet days to be scored at a lead at all. */
const MIN_SCORED_DAYS = 3;
/** The lead, hours, that each previous run stands for: the middle of the day it was forecast for. */
const LEAD_HOURS: Record<VerifyLead, number> = { 1: 36, 3: 84, 5: 132 };
/** Past the last verified lead, weight changes fade out by this lead. */
const WEIGHT_FADE_HOURS = 240;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** A gauge and what it measured each station-local day. */
export interface GaugeInput {
  station: SnotelStation;
  miles: number;
  water: Map<string, number | null>;
}

/** One model's previous runs, one per gauge in the same order; null where the request failed. */
export interface ModelInput {
  key: string;
  runs: (PreviousRuns | null)[];
}

interface Pair {
  obs: number;
  model: number;
}

/** A model's total over a station-local day from the runs at one lead, or null if too many hours are missing. */
function dayTotal(runs: PreviousRuns, lead: VerifyLead, start: number): number | null {
  const series = runs.leads.get(lead);
  if (!series) return null;
  let total = 0;
  let have = 0;
  // Each value is the hour ending at its time, so the day is (start, start + 24 h].
  for (let i = 0; i < runs.times.length; i++) {
    const t = runs.times[i];
    if (t <= start || t > start + DAY) continue;
    const v = series[i];
    if (v === null) continue;
    total += v;
    have++;
  }
  return have >= MIN_HOURS ? total / 25.4 : null;
}

/** Gauge days, within the window and over by `now`, with their start. */
function windowDays(gauge: GaugeInput, now: number): { start: number; obs: number }[] {
  const out: { start: number; obs: number }[] = [];
  for (const [date, obs] of gauge.water) {
    if (obs === null) continue;
    const start = stationTime(date, gauge.station.utcOffset);
    if (start + DAY > now || start < now - (VERIFY_DAYS + 1) * DAY) continue;
    out.push({ start, obs });
  }
  return out;
}

/** Wet-day pairs for one model at one gauge and lead. */
function pairs(runs: PreviousRuns | null, days: { start: number; obs: number }[], lead: VerifyLead): Pair[] {
  if (!runs) return [];
  const out: Pair[] = [];
  for (const d of days) {
    const model = dayTotal(runs, lead, d.start);
    if (model === null) continue;
    if (model >= WET_IN || d.obs >= WET_IN) out.push({ obs: d.obs, model });
  }
  return out;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Cell {
  /** ln(measured / forecast), pooled across leads. */
  y: number;
  /** 0–1, from how much water there was. */
  w: number;
}

/**
 * Fits `a` per model and the shared `g` by alternating weighted least
 * squares with ridge priors — a handful of rows, so a few dozen rounds is
 * plenty. For `g`, each gauge counts once, not once per model: the models
 * all lean on the same measurement there.
 */
function fit(cells: (Cell | null)[][], x: number[]): { a: number[]; g: number } {
  const a = cells.map(() => 0);
  let g = PRIOR_GRADIENT;
  for (let round = 0; round < 50; round++) {
    cells.forEach((row, m) => {
      let num = 0;
      let den = INTERCEPT_PRIOR;
      row.forEach((c, s) => {
        if (!c) return;
        num += c.w * (c.y - g * x[s]);
        den += c.w;
      });
      a[m] = clamp(num / den, -MAX_LOG_CORRECTION, MAX_LOG_CORRECTION);
    });
    let num = GRADIENT_PRIOR * PRIOR_GRADIENT;
    let den = GRADIENT_PRIOR;
    x.forEach((xs, s) => {
      let rw = 0;
      let r = 0;
      let n = 0;
      cells.forEach((row, m) => {
        const c = row[s];
        if (!c) return;
        r += c.w * (c.y - a[m]);
        rw += c.w;
        n++;
      });
      if (rw === 0) return;
      const weight = rw / n;
      num += weight * xs * (r / rw);
      den += weight * xs * xs;
    });
    g = clamp(num / den, ...GRADIENT_RANGE);
  }
  return { a, g };
}

/**
 * The verification for a spot at `targetFt` from its gauges and the models'
 * previous runs there. Null without a gauge.
 */
export function verify(gauges: GaugeInput[], models: ModelInput[], targetFt: number, now: number): BlendVerification | null {
  if (gauges.length === 0) return null;
  const days = gauges.map((g) => windowDays(g, now));
  const x = gauges.map((g) => (g.station.elevationFt - targetFt) / 1000);

  // pairs[model][gauge][lead]
  const all = models.map((m) => gauges.map((_, s) => new Map(VERIFY_LEADS.map((lead) => [lead, pairs(m.runs[s], days[s], lead)] as const))));

  const cells = all.map((byGauge) =>
    byGauge.map((byLead): Cell | null => {
      const leads = [...byLead.values()].filter((p) => p.length > 0);
      if (leads.length === 0) return null;
      const obs = sum(leads.map((p) => sum(p.map((q) => q.obs)))) / leads.length;
      const model = sum(leads.map((p) => sum(p.map((q) => q.model)))) / leads.length;
      return { y: Math.log((obs + RATIO_PAD_IN) / (model + RATIO_PAD_IN)), w: Math.min(1, (obs + model) / 2 / FULL_WEIGHT_IN) };
    }),
  );
  const { a, g } = fit(cells, x);

  // Errors after correction, per lead, to weigh the models against each other.
  const errors = VERIFY_LEADS.map((lead) =>
    all.map((byGauge, m) => {
      const misses = byGauge.flatMap((byLead, s) => byLead.get(lead)!.map((p) => Math.abs(p.model * Math.exp(a[m] + g * x[s]) - p.obs)));
      return misses.length >= MIN_SCORED_DAYS ? { mae: sum(misses) / misses.length, n: misses.length } : null;
    }),
  );
  const medians = errors.map((row) => {
    const maes = row.flatMap((e) => (e ? [e.mae] : []));
    return maes.length >= 2 ? median(maes) : null;
  });

  const verified: VerifiedModel[] = models.map((m, i) => {
    const weights: [number, number][] = [];
    VERIFY_LEADS.forEach((lead, l) => {
      const e = errors[l][i];
      const ref = medians[l];
      if (!e || ref === null) return;
      const ln = clamp(Math.log(Math.max(ref, 0.01) / Math.max(e.mae, 0.01)), -LN2, LN2) * (e.n / (e.n + WEIGHT_HALF_DAYS));
      weights.push([LEAD_HOURS[lead], round(Math.exp(ln), 3)]);
    });
    // The record shown: the shortest lead the model has.
    const lead = VERIFY_LEADS.find((l) => all[i].some((byLead) => byLead.get(l)!.length > 0));
    const shown = lead === undefined ? [] : all[i].flatMap((byLead) => byLead.get(lead)!);
    const err = lead === undefined ? null : errors[VERIFY_LEADS.indexOf(lead)][i];
    return {
      key: m.key,
      wetDays: shown.length,
      forecastIn: round(sum(shown.map((p) => p.model)), 2),
      measuredIn: round(sum(shown.map((p) => p.obs)), 2),
      errorIn: err ? round(err.mae, 2) : null,
      logCorrection: round(a[i], 4),
      weights,
    };
  });

  const stations: VerifiedStation[] = gauges.map((gauge, s) => ({
    id: gauge.station.id,
    name: gauge.station.name,
    elevationFt: gauge.station.elevationFt,
    miles: round(gauge.miles, 1),
    measuredIn: days[s].length > 0 ? round(sum(days[s].map((d) => d.obs)), 2) : null,
  }));

  return { targetFt: Math.round(targetFt), days: VERIFY_DAYS, stations, gradient: round(g, 4), models: verified };
}

// --- Using it ------------------------------------------------------------------------

const byKey = new Map(BLEND_MODELS.map((m) => [m.key, m]));

/** A model's own record, or the one it borrows (`verifiedBy`). */
function recordFor(v: BlendVerification, key: string): VerifiedModel | undefined {
  return v.models.find((m) => m.key === key) ?? v.models.find((m) => m.key === byKey.get(key)?.verifiedBy);
}

/**
 * What to multiply a model's precipitation by, `dzFt` feet above (or below)
 * the height the verification was done for. With no verification, only the
 * prior gradient: still more snow up high than the models see, just not
 * learned here.
 */
export function precipFactor(v: BlendVerification | null, key: string, dzFt: number): number {
  const a = v ? (recordFor(v, key)?.logCorrection ?? 0) : 0;
  const g = v ? v.gradient : PRIOR_GRADIENT;
  return Math.exp(clamp(a + (g * dzFt) / 1000, -MAX_LOG_CORRECTION, MAX_LOG_CORRECTION));
}

/**
 * What to multiply a model's blend weight by at `leadHours`: its learned
 * factors, straight lines between, flat before the first and fading to 1
 * by day 10 after the last. Only a model's own record counts.
 */
export function weightFactor(v: BlendVerification | null, key: string, leadHours: number): number {
  const points = v?.models.find((m) => m.key === key)?.weights ?? [];
  if (points.length === 0) return 1;
  return weightAt([...points, [Math.max(WEIGHT_FADE_HOURS, points.at(-1)![0] + 1), 1]], leadHours);
}
