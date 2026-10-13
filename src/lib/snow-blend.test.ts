import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import { BLEND_MODELS, modelUrl, parseDeterministic, parseEnsemble, weightAt, type BlendModel } from "./openmeteo";
import { buildBlend, buildBuckets, localParts } from "./snow-blend";

const model = (key: string): BlendModel => BLEND_MODELS.find((m) => m.key === key)!;
const TZ = "America/Denver";
/** Midnight, Oct 13 2026, in Denver (MDT, UTC−6) — where Open-Meteo starts its hours. */
const START = Date.parse("2026-10-13T06:00:00Z");
const HOURS = 16 * 24;
const at = (localIso: string) => Date.parse(`${localIso}-06:00`);
/** 3 PM local on the first day. */
const NOW = at("2026-10-13T15:00:00");

interface Hour {
  t2?: number | null;
  rh?: number | null;
  p?: number | null;
  sf?: number | null;
  wind?: number | null;
  sp?: number | null;
  levels?: Record<number, number> | null;
}

/** Cold and calm at 2,655 m, with a 12-hour storm from midnight to noon on Oct 14 (2 mm/h). */
const alta = (time: number): Hour => {
  const storm = time >= at("2026-10-14T00:00:00") && time < at("2026-10-14T12:00:00");
  return {
    t2: -8, rh: 95, p: storm ? 2 : 0, sf: storm ? 1.4 : 0, wind: 3, sp: 740,
    // 1000 and 850 hPa are underground at 740 hPa, and warm: they must be ignored.
    levels: { 1000: 6, 925: 4, 850: 2, 700: -10, 600: -15, 500: -25 },
  };
};

/** An Open-Meteo forecast response, `timeformat=unixtime`. */
function omResponse(hour: (time: number, i: number) => Hour, opts: { hours?: number; every?: number } = {}) {
  const n = opts.hours ?? HOURS;
  const every = opts.every ?? 1;
  const times = Array.from({ length: n }, (_, i) => START / 1000 + i * 3600);
  const rows = times.map((t, i) => (i % every === 0 ? hour(t * 1000, i) : ({} as Hour)));
  const col = (f: (h: Hour) => number | null | undefined) => rows.map((h) => f(h) ?? null);
  const hourly: Record<string, unknown> = {
    time: times,
    temperature_2m: col((h) => h.t2),
    relative_humidity_2m: col((h) => h.rh),
    precipitation: col((h) => h.p),
    snowfall: col((h) => h.sf),
    wind_speed_10m: col((h) => h.wind),
    surface_pressure: col((h) => h.sp),
  };
  for (const hPa of [1000, 925, 850, 700, 600, 500]) hourly[`temperature_${hPa}hPa`] = col((h) => h.levels?.[hPa]);
  return { latitude: 40.59, longitude: -111.64, elevation: 2655, timezone: TZ, utc_offset_seconds: -21600, hourly };
}

/** An ensemble response: the control run and members, each scaling the storm. */
function ensembleResponse(scales: number[]) {
  const base = omResponse(alta).hourly as Record<string, (number | null)[]>;
  const hourly: Record<string, unknown> = { time: base.time };
  scales.forEach((scale, m) => {
    const suffix = m === 0 ? "" : `_member${String(m).padStart(2, "0")}`;
    hourly[`temperature_2m${suffix}`] = base.temperature_2m;
    hourly[`relative_humidity_2m${suffix}`] = base.relative_humidity_2m;
    hourly[`precipitation${suffix}`] = base.precipitation.map((p) => (p === null ? null : p * scale));
    hourly[`snowfall${suffix}`] = base.snowfall.map((s) => (s === null ? null : s * scale));
    hourly[`wind_speed_10m${suffix}`] = base.wind_speed_10m;
  });
  return { elevation: 2655, timezone: TZ, hourly };
}

describe("weightAt", () => {
  it("follows a model's curve and holds past its ends", () => {
    const hrrr = model("hrrr").weight;
    expect(weightAt(hrrr, 0)).toBe(3);
    expect(weightAt(hrrr, 33)).toBeCloseTo(1.5);
    expect(weightAt(hrrr, 100)).toBe(0);
    expect(weightAt(model("gefs").weight, 168)).toBeCloseTo(1);
    expect(weightAt(model("gfs").weight, 300)).toBe(1);
  });
});

describe("modelUrl", () => {
  it("asks for one model, in Unix time and m/s, with the column for deterministic models", () => {
    const url = new URL(modelUrl(model("ecmwf"), 40.58841, -111.63862));
    expect(url.host).toBe("api.open-meteo.com");
    expect(url.searchParams.get("models")).toBe("ecmwf_ifs");
    expect(url.searchParams.get("latitude")).toBe("40.588");
    expect(url.searchParams.get("timeformat")).toBe("unixtime");
    expect(url.searchParams.get("wind_speed_unit")).toBe("ms");
    expect(url.searchParams.get("hourly")).toContain("temperature_700hPa");
    const ens = new URL(modelUrl(model("gefs"), 40.588, -111.638));
    expect(ens.host).toBe("ensemble-api.open-meteo.com");
    expect(ens.searchParams.get("hourly")).not.toContain("hPa");
  });
});

describe("parsing", () => {
  it("reads a recorded Open-Meteo response", () => {
    const run = parseDeterministic(model("ecmwf"), jsonFixture("open-meteo-ecmwf.json"));
    expect(run.timezone).toBe("America/Denver");
    expect(run.elevation).toBe(2655);
    expect(run.times[1] - run.times[0]).toBe(3600_000);
    expect(run.levels.find((l) => l.hPa === 700)!.tempC[0]).toBe(-9.4);
    expect(run.snowfallCm.length).toBe(run.times.length);
  });

  it("fills a variable the model doesn't have with nulls", () => {
    const json = omResponse(alta, { hours: 3 });
    delete (json.hourly as Record<string, unknown>).temperature_500hPa;
    const run = parseDeterministic(model("nbm"), json);
    expect(run.levels.find((l) => l.hPa === 500)!.tempC).toEqual([null, null, null]);
  });

  it("refuses an error answer or one without times", () => {
    expect(() => parseDeterministic(model("gfs"), { error: true, reason: "Cannot initialize" })).toThrow(/Cannot initialize/);
    expect(() => parseDeterministic(model("gfs"), { hourly: {} })).toThrow();
  });

  it("takes the control run and every member, skipping members without precipitation", () => {
    const json = ensembleResponse([1, 0.5, 2]);
    (json.hourly as Record<string, unknown>).precipitation_member03 = [null, null];
    const run = parseEnsemble(model("gefs"), json);
    expect(run.members).toHaveLength(3);
  });
});

describe("buildBuckets", () => {
  const times = Array.from({ length: HOURS }, (_, i) => START + i * 3600_000);

  it("starts at the current hour and splits at 6 AM and 6 PM local", () => {
    const buckets = buildBuckets(times, TZ, NOW + 20 * 60_000);
    expect(buckets[0]).toMatchObject({ date: "2026-10-13", half: "day" });
    expect(buckets[0].hours).toHaveLength(3);
    expect(buckets[1]).toMatchObject({ date: "2026-10-13", half: "night" });
    expect(buckets[1].hours).toHaveLength(12);
    expect(buckets[2]).toMatchObject({ date: "2026-10-14", half: "day" });
  });

  it("puts the small hours with the night before", () => {
    const buckets = buildBuckets(times, TZ, at("2026-10-14T02:00:00"));
    expect(buckets[0]).toMatchObject({ date: "2026-10-13", half: "night" });
    expect(buckets[0].hours).toHaveLength(4);
  });

  it("keeps local time across the end of daylight saving, and drops a partial last night", () => {
    // Three weeks, to reach Nov 1, when Denver falls back at 2 AM.
    const long = Array.from({ length: 21 * 24 }, (_, i) => START + i * 3600_000);
    const buckets = buildBuckets(long, TZ, NOW);
    const fallBack = buckets.find((b) => b.date === "2026-10-31" && b.half === "night")!;
    expect(fallBack.hours).toHaveLength(13);
    expect(localParts(long[buckets.at(-1)!.hours.at(-1)!], TZ).hour).toBe(17);
  });
});

describe("buildBlend", () => {
  const ecmwf = parseDeterministic(model("ecmwf"), omResponse(alta));

  it("turns the storm into snow with a cold-column ratio", () => {
    const blend = buildBlend([ecmwf], NOW);
    const [today, wednesday, thursday] = blend.days;
    // 24 mm of water, half each side of 6 AM, at 18:1 (warmest air above the ground is −8 °C).
    expect(today.date).toBe("2026-10-13");
    expect(today.snowIn).toBeCloseTo(8.5, 1);
    expect(today.nightIn).toBeCloseTo(8.5, 1);
    expect(today.dayIn).toBe(0);
    expect(wednesday.snowIn).toBeCloseTo(8.5, 1);
    expect(wednesday.precipIn).toBeCloseTo(0.47, 2);
    expect(wednesday.ratio).toBe(18);
    expect(thursday.snowIn).toBe(0);
    expect(today.high).toBe(18);
    expect(blend.days).toHaveLength(15);
    expect(blend.periods.map((p) => [p.label, p.snowIn])).toEqual([
      ["Next 5 days", 17],
      ["Days 6–10", 0],
      ["Days 11–15", 0],
    ]);
    expect(blend.elevationM).toBe(2655);
  });

  it("rains in a valley with a warm layer aloft, whatever the model's own split says", () => {
    const valley = parseDeterministic(
      model("ecmwf"),
      omResponse((t) => ({ ...alta(t), t2: 0.5, rh: 95, sp: 1010, levels: { 1000: 1, 925: 2, 850: 4, 700: -6, 600: -12, 500: -24 } })),
    );
    const [, wednesday] = buildBlend([valley], NOW).days;
    expect(wednesday.snowIn).toBe(0);
    expect(wednesday.precipIn).toBeCloseTo(0.47, 2);
  });

  it("weights high-resolution models up close", () => {
    // HRRR (weight 3 at under 18 h) has twice the storm; GFS (weight 1) the base.
    const soon = (t: number) => {
      const storm = t >= at("2026-10-13T18:00:00") && t < at("2026-10-14T00:00:00");
      return { ...alta(t), p: storm ? 2 : 0 };
    };
    const hrrr = parseDeterministic(model("hrrr"), omResponse((t) => ({ ...soon(t), p: soon(t).p * 2 }), { hours: 48 }));
    const gfs = parseDeterministic(model("gfs"), omResponse(soon));
    const [today] = buildBlend([hrrr, gfs], NOW).days;
    const gfsAlone = today.models.find((m) => m.key === "gfs")!.snowIn;
    const hrrrAlone = today.models.find((m) => m.key === "hrrr")!.snowIn;
    expect(hrrrAlone).toBeCloseTo(gfsAlone * 2, 0);
    expect(today.snowIn!).toBeCloseTo((3 * hrrrAlone + gfsAlone) / 4, 0);
    expect(today.lowIn).toBe(gfsAlone);
    expect(today.highIn).toBe(hrrrAlone);
  });

  it("lends the consensus column to a model without levels", () => {
    const nbm = parseDeterministic(model("nbm"), omResponse((t) => ({ ...alta(t), levels: null })));
    const blend = buildBlend([ecmwf, nbm], NOW);
    const wednesday = blend.days[1];
    expect(wednesday.models.find((m) => m.key === "nbm")!.snowIn).toBeCloseTo(8.5, 1);
  });

  it("counts a six-hourly model as covering the days between its steps", () => {
    const aifs = parseDeterministic(model("aifs"), omResponse((t) => ({ ...alta(t), p: alta(t).p! * 3 }), { every: 6 }));
    const wednesday = buildBlend([ecmwf, aifs], NOW).days[1];
    expect(wednesday.models.find((m) => m.key === "aifs")).toBeDefined();
  });

  it("uses an ensemble for the range early and for the blend late", () => {
    const gefs = parseEnsemble(model("gefs"), ensembleResponse([1, 0.5, 1.5, 2, 0]));
    const blend = buildBlend([ecmwf, gefs], NOW);
    const wednesday = blend.days[1];
    // Before day 5 the ensemble has no weight: the blend is ECMWF's.
    expect(wednesday.snowIn).toBeCloseTo(8.5, 1);
    const g = wednesday.models.find((m) => m.key === "gefs")!;
    expect(g.members).toBe(5);
    expect(g.snowIn).toBeCloseTo(8.5, 1);
    expect(g.p10In!).toBeLessThan(g.p90In!);
    expect(wednesday.lowIn).toBe(g.p10In);
    expect(wednesday.highIn).toBe(g.p90In);
  });

  it("lists models that failed, and needs at least one that answered", () => {
    expect(buildBlend([ecmwf], NOW, ["hrrr"]).failed).toEqual(["hrrr"]);
    expect(() => buildBlend([], NOW)).toThrow();
  });
});
