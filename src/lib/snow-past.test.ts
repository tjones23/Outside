import { describe, expect, it } from "vitest";
import { BLEND_MODELS, parseDeterministic, pastModelUrl, type BlendModel } from "./openmeteo";
import { buildPast } from "./snow-past";

const model = (key: string): BlendModel => BLEND_MODELS.find((m) => m.key === key)!;
const TZ = "America/Denver";
/** Local midnight Sep 28 2026 in Denver (MDT, UTC−6): where past_days=16 starts on Oct 14. */
const START = Date.parse("2026-09-28T06:00:00Z");
const HOURS = 17 * 24;
const at = (localIso: string) => Date.parse(`${localIso}-06:00`);
/** 3:20 PM local, Oct 14. */
const NOW = at("2026-10-14T15:20:00");

/** Cold at 2,655 m; 1 mm/h of water from `from` for `hours` hours. */
function response(storms: { from: string; hours: number; mm?: number }[]) {
  const times = Array.from({ length: HOURS }, (_, i) => START / 1000 + i * 3600);
  const precip = times.map((t) => {
    const ms = t * 1000;
    const s = storms.find((st) => ms >= at(st.from) && ms < at(st.from) + st.hours * 3600_000);
    return s ? (s.mm ?? 1) : 0;
  });
  const hourly: Record<string, unknown> = {
    time: times,
    temperature_2m: times.map(() => -8),
    relative_humidity_2m: times.map(() => 95),
    precipitation: precip,
    snowfall: precip.map((p) => p * 0.7),
    wind_speed_10m: times.map(() => 2),
    surface_pressure: times.map(() => 740),
  };
  // A column cold enough for about 17:1 (warmest level −7 °C).
  for (const [hPa, t] of [[1000, 5], [925, 3], [850, 1], [700, -7], [600, -14], [500, -24]]) {
    hourly[`temperature_${hPa}hPa`] = times.map(() => t);
  }
  return { latitude: 40.59, longitude: -111.64, elevation: 2655, timezone: TZ, hourly };
}

describe("pastModelUrl", () => {
  it("asks for the last 16 days and today", () => {
    const url = new URL(pastModelUrl(model("hrrr"), 40.588, -111.638));
    expect(url.searchParams.get("past_days")).toBe("16");
    expect(url.searchParams.get("forecast_days")).toBe("1");
    expect(url.searchParams.get("models")).toBe("ncep_hrrr_conus");
  });
});

describe("buildPast", () => {
  const storms = [
    { from: "2026-10-13T20:00:00", hours: 6 }, // last night: in "Last 5 days", row Oct 13
    { from: "2026-10-06T10:00:00", hours: 4 }, // 8 days ago: "6–10 days ago", row Oct 6
    { from: "2026-10-14T16:00:00", hours: 4 }, // later today: hasn't happened
  ];
  const runs = [parseDeterministic(model("hrrr"), response(storms)), parseDeterministic(model("gfs"), response(storms))];
  const past = buildPast(runs, NOW);

  it("has 15 whole 6 AM days and today's so far, oldest first", () => {
    expect(past.days).toHaveLength(16);
    expect(past.days[0]).toMatchObject({ date: "2026-09-29", partial: false });
    expect(past.days.at(-1)).toMatchObject({ date: "2026-10-14", partial: true });
  });

  it("puts each storm in its day and stretch, and nothing from later today", () => {
    const day = (date: string) => past.days.find((d) => d.date === date)!;
    expect(day("2026-10-13").snowIn).toBeGreaterThan(3);
    expect(day("2026-10-06").snowIn).toBeGreaterThan(2);
    expect(day("2026-10-14").snowIn).toBe(0);
    expect(day("2026-10-10").snowIn).toBe(0);
    const [last5, mid, old] = past.periods;
    expect(last5.label).toBe("Last 5 days");
    expect(last5.snowIn).toBe(day("2026-10-13").snowIn);
    expect(mid.snowIn).toBe(day("2026-10-06").snowIn);
    expect(old.snowIn).toBe(0);
  });

  it("turns 6 mm of water into a cold-column ratio, not Open-Meteo's 7:1", () => {
    const inches = past.periods[0].snowIn!;
    // 6 mm = 0.236″ of water; 7:1 would be 1.7″.
    expect(inches / 0.236).toBeGreaterThan(14);
  });

  it("gives the range across models and each model's total", () => {
    const [last5] = past.periods;
    expect(last5.models.map((m) => m.key)).toEqual(["hrrr", "gfs"]);
    expect(last5.lowIn).toBeLessThanOrEqual(last5.snowIn!);
    expect(last5.highIn).toBeGreaterThanOrEqual(last5.snowIn!);
  });

  it("leaves a stretch with no total when the runs don't reach back that far", () => {
    const short = response([]);
    const h = short.hourly as Record<string, unknown[]>;
    // Drop the first ten days.
    for (const k of Object.keys(h)) h[k] = h[k].slice(240);
    const p = buildPast([parseDeterministic(model("hrrr"), short)], NOW);
    expect(p.periods[2].snowIn).toBeNull();
    expect(p.periods[0].snowIn).toBe(0);
  });
});
