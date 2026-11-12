import { describe, expect, it } from "vitest";
import { BLEND_MODELS, parsePreviousRuns, previousRunsUrl, VERIFY_LEADS, type PreviousRuns, type VerifyLead } from "./openmeteo";
import type { SnotelStation } from "./snotel";
import { precipFactor, PRIOR_GRADIENT, verify, weightFactor, type GaugeInput } from "./snow-verify";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** 10 AM, Nov 12 2026, at a station on UTC−8. */
const NOW = Date.parse("2026-11-12T18:00:00Z");
const OFFSET = -8;

const station = (id: string, elevationFt: number): SnotelStation => ({ id, name: id, lat: 40.6, lon: -111.6, elevationFt, utcOffset: OFFSET });

/** Station-local dates, `k` days before today's. */
const dateAgo = (k: number) => new Date(NOW + OFFSET * HOUR - k * DAY).toISOString().slice(0, 10);
const PAST = Array.from({ length: 30 }, (_, i) => dateAgo(30 - i));
/** Every third day it snows. */
const wet = (date: string) => PAST.indexOf(date) % 3 === 0;

function gauge(s: SnotelStation, inches: (date: string) => number, miles = 1): GaugeInput {
  return { station: s, miles, water: new Map(PAST.map((d) => [d, inches(d)])) };
}

/** Previous runs whose day totals are `inches(date)`, spread evenly over its hours, at every lead. */
function runs(inches: (date: string, lead: VerifyLead) => number, leads: readonly VerifyLead[] = VERIFY_LEADS): PreviousRuns {
  const start = Date.parse(`${dateAgo(31)}T00:00:00Z`) - OFFSET * HOUR;
  const times = Array.from({ length: 33 * 24 }, (_, i) => start + (i + 1) * HOUR);
  const dateOf = (t: number) => new Date(t - HOUR + OFFSET * HOUR).toISOString().slice(0, 10);
  return {
    times,
    leads: new Map(VERIFY_LEADS.map((lead) => [lead, times.map((t) => (leads.includes(lead) ? (inches(dateOf(t), lead) * 25.4) / 24 : null))])),
  };
}

const storm = (amount: number) => (date: string) => (wet(date) ? amount : 0);

describe("verify", () => {
  it("needs a gauge", () => {
    expect(verify([], [], 9000, NOW)).toBeNull();
  });

  it("corrects a model that runs dry, and leaves one that's right alone", () => {
    const g = station("1:UT:SNTL", 9000);
    const v = verify(
      [gauge(g, storm(1))],
      [
        { key: "gfs", runs: [runs(storm(0.5))] },
        { key: "ecmwf", runs: [runs(storm(1))] },
      ],
      9000,
      NOW,
    )!;
    const gfs = v.models.find((m) => m.key === "gfs")!;
    const ecmwf = v.models.find((m) => m.key === "ecmwf")!;
    // 10 storm days of 1″ against 0.5″: the ratio is about 2, shrunk a little for one gauge.
    expect(gfs.wetDays).toBe(10);
    expect(gfs.forecastIn).toBeCloseTo(5);
    expect(gfs.measuredIn).toBeCloseTo(10);
    expect(Math.exp(gfs.logCorrection)).toBeGreaterThan(1.5);
    expect(Math.exp(gfs.logCorrection)).toBeLessThan(2);
    expect(Math.abs(ecmwf.logCorrection)).toBeLessThan(0.05);
    expect(precipFactor(v, "gfs", 0)).toBeCloseTo(Math.exp(gfs.logCorrection));
  });

  it("weights a model up for missing by less than the others", () => {
    const g = station("1:UT:SNTL", 9000);
    // Right in total, but half of each storm a day late: same totals, worse days.
    const late = (date: string) => (wet(date) || wet(PAST[PAST.indexOf(date) - 1] ?? "") ? 0.5 : 0);
    const v = verify(
      [gauge(g, storm(1))],
      [
        { key: "ecmwf", runs: [runs(storm(1))] },
        { key: "gfs", runs: [runs(storm(1.3))] },
        { key: "icon", runs: [runs(late)] },
      ],
      9000,
      NOW,
    )!;
    const weight = (key: string) => weightFactor(v, key, 36);
    expect(weight("ecmwf")).toBeGreaterThan(1);
    expect(weight("icon")).toBeLessThan(1);
    // At most double or half, and fading back by day 10.
    for (const [, w] of v.models.flatMap((m) => m.weights)) {
      expect(w).toBeGreaterThanOrEqual(0.5);
      expect(w).toBeLessThanOrEqual(2);
    }
    expect(weightFactor(v, "ecmwf", 240)).toBe(1);
  });

  it("learns how much more falls higher up from gauges at different heights", () => {
    const low = station("1:UT:SNTL", 8000);
    const high = station("2:UT:SNTL", 10000);
    // The model says the same at both; the high gauge gets 60% more.
    const v = verify(
      [gauge(low, storm(1)), gauge(high, storm(1.6))],
      ["gfs", "ecmwf", "nbm"].map((key) => ({ key, runs: [runs(storm(1)), runs(storm(1))] })),
      9000,
      NOW,
    )!;
    expect(v.gradient).toBeGreaterThan(PRIOR_GRADIENT);
    expect(precipFactor(v, "gfs", 1000)).toBeGreaterThan(precipFactor(v, "gfs", 0));
    expect(precipFactor(v, "gfs", -1000)).toBeLessThan(precipFactor(v, "gfs", 0));
    // Halfway up, between the two.
    expect(precipFactor(v, "gfs", 0)).toBeGreaterThan(1);
    expect(precipFactor(v, "gfs", 0)).toBeLessThan(1.6);
  });

  it("changes nothing after a dry month", () => {
    const v = verify([gauge(station("1:UT:SNTL", 9000), () => 0)], [{ key: "gfs", runs: [runs(() => 0)] }], 9000, NOW)!;
    expect(v.models[0]).toMatchObject({ wetDays: 0, logCorrection: 0, weights: [] });
    expect(precipFactor(v, "gfs", 0)).toBe(1);
    expect(weightFactor(v, "gfs", 36)).toBe(1);
  });

  it("only counts days that are over, and skips a model whose runs failed", () => {
    const g = gauge(station("1:UT:SNTL", 9000), storm(1));
    g.water.set(dateAgo(0), 5);
    const v = verify([g], [{ key: "gfs", runs: [runs(storm(1))] }, { key: "icon", runs: [null] }], 9000, NOW)!;
    expect(v.stations[0].measuredIn).toBeCloseTo(10);
    expect(v.models.find((m) => m.key === "icon")).toMatchObject({ wetDays: 0, logCorrection: 0 });
  });

  it("scores HRRR at the one lead it has", () => {
    const v = verify(
      [gauge(station("1:UT:SNTL", 9000), storm(1))],
      [
        { key: "hrrr", runs: [runs(storm(0.8), [1])] },
        { key: "ecmwf", runs: [runs(storm(1))] },
      ],
      9000,
      NOW,
    )!;
    expect(v.models.find((m) => m.key === "hrrr")!.weights.map(([h]) => h)).toEqual([36]);
  });
});

describe("using a verification", () => {
  const v = verify(
    [gauge(station("1:UT:SNTL", 9000), storm(1))],
    [
      { key: "gfs", runs: [runs(storm(0.5))] },
      { key: "aifs", runs: [runs(storm(1))] },
    ],
    9000,
    NOW,
  )!;

  it("lends a model's correction, not its weight, to one without past runs", () => {
    expect(BLEND_MODELS.find((m) => m.key === "gefs")!.verifiedBy).toBe("gfs");
    expect(precipFactor(v, "gefs", 0)).toBe(precipFactor(v, "gfs", 0));
    expect(weightFactor(v, "gefs", 36)).toBe(1);
  });

  it("still raises precipitation up high with no verification at all", () => {
    expect(precipFactor(null, "gfs", 0)).toBe(1);
    expect(precipFactor(null, "gfs", 2000)).toBeCloseTo(Math.exp(2 * PRIOR_GRADIENT));
    expect(weightFactor(null, "gfs", 36)).toBe(1);
  });

  it("follows a model's weight curve between leads and fades it out by day 10", () => {
    const one = { ...v, models: [{ ...v.models[0], key: "nbm", weights: [[36, 2], [132, 1.5]] as [number, number][] }] };
    expect(weightFactor(one, "nbm", 0)).toBe(2);
    expect(weightFactor(one, "nbm", 84)).toBeCloseTo(1.75);
    expect(weightFactor(one, "nbm", 186)).toBeCloseTo(1.25);
    expect(weightFactor(one, "nbm", 400)).toBe(1);
  });
});

describe("previous runs", () => {
  const gfs = BLEND_MODELS.find((m) => m.key === "gfs")!;
  const points = [
    { lat: 40.59111, lon: -111.6382, elevationM: 2667.2 },
    { lat: 40.6, lon: -111.58, elevationM: 2679 },
  ];

  it("asks for every gauge at once, at its height, for each lead", () => {
    const url = new URL(previousRunsUrl(gfs, points));
    expect(url.host).toBe("previous-runs-api.open-meteo.com");
    expect(url.searchParams.get("latitude")).toBe("40.591,40.6");
    expect(url.searchParams.get("elevation")).toBe("2667,2679");
    expect(url.searchParams.get("hourly")).toBe(
      "precipitation_previous_day1,precipitation_previous_day3,precipitation_previous_day5",
    );
    expect(url.searchParams.get("past_days")).toBe("31");
  });

  it("reads one spot or several", () => {
    const one = { hourly: { time: [1, 2], precipitation_previous_day1: [0.5, null] } };
    expect(parsePreviousRuns(one, 1)[0].leads.get(1)).toEqual([0.5, null]);
    expect(parsePreviousRuns(one, 1)[0].leads.get(3)).toEqual([null, null]);
    expect(parsePreviousRuns([one, one], 2)).toHaveLength(2);
    expect(() => parsePreviousRuns([one], 2)).toThrow(/1 spots for 2/);
    expect(() => parsePreviousRuns({ error: true, reason: "No data" }, 1)).toThrow(/No data/);
  });
});
