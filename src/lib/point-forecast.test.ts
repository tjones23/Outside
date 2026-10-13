import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import { formatInches } from "./format";
import {
  amountBetween,
  buildDays,
  dayGlyph,
  forecastGlyph,
  parseCoord,
  parseDuration,
  parseGridAmounts,
  parsePeriods,
  parsePoint,
  pointsUrl,
} from "./point-forecast";

const at = (iso: string) => Date.parse(iso);

describe("parseCoord", () => {
  it("rounds to three decimals so nearby repeats share a cache entry", () => {
    expect(parseCoord("40.58841", "-111.63862")).toEqual({ lat: 40.588, lon: -111.639 });
  });

  it("rejects missing, blank, non-numeric and out-of-range input", () => {
    expect(parseCoord(null, "-111")).toBeNull();
    expect(parseCoord("", "-111")).toBeNull();
    expect(parseCoord("north", "-111")).toBeNull();
    expect(parseCoord("91", "0")).toBeNull();
    expect(parseCoord("0", "-181")).toBeNull();
  });
});

describe("pointsUrl", () => {
  it("asks NWS with at most three decimals", () => {
    expect(pointsUrl(40.58841, -111.63862)).toBe("https://api.weather.gov/points/40.588,-111.639");
  });
});

describe("parsePoint", () => {
  it("reads the grid cell's URLs and nearest place", () => {
    expect(parsePoint(jsonFixture("nws-points.json"))).toEqual({
      forecastUrl: "https://api.weather.gov/gridpoints/SLC/108,166/forecast",
      gridUrl: "https://api.weather.gov/gridpoints/SLC/108,166",
      place: "Alta, UT",
    });
  });

  it("refuses a point with no grid, or links off the NWS API", () => {
    expect(() => parsePoint({ properties: {} })).toThrow();
    expect(() =>
      parsePoint({ properties: { forecast: "https://evil.example/f", forecastGridData: "https://api.weather.gov/g" } }),
    ).toThrow();
  });
});

describe("parsePeriods", () => {
  it("reads every period, with a missing chance as null", () => {
    const { updated, periods } = parsePeriods(jsonFixture("nws-forecast.json"));
    expect(updated).toBe("2026-10-13T20:41:07+00:00");
    expect(periods).toHaveLength(8);
    expect(periods[1]).toMatchObject({ name: "Tonight", isDaytime: false, temperature: 28, precipChance: 80, short: "Snow Likely" });
    expect(periods[1].detail).toContain("3 to 5 inches");
    expect(periods[5].precipChance).toBeNull();
  });

  it("takes temperatures as bare numbers or { value }, converting Celsius", () => {
    const base = { name: "Today", startTime: "2026-10-13T06:00:00-06:00", endTime: "2026-10-13T18:00:00-06:00", isDaytime: true };
    const { periods } = parsePeriods({
      properties: {
        periods: [
          { ...base, temperature: { unitCode: "wmoUnit:degF", value: 41 } },
          { ...base, temperature: 5, temperatureUnit: "C" },
          { name: "no times" },
        ],
      },
    });
    expect(periods.map((p) => p.temperature)).toEqual([41, 41]);
  });
});

describe("parseDuration", () => {
  it("reads the durations NWS uses", () => {
    expect(parseDuration("PT6H")).toBe(6 * 3600_000);
    expect(parseDuration("P1D")).toBe(24 * 3600_000);
    expect(parseDuration("P1DT12H")).toBe(36 * 3600_000);
    expect(parseDuration("PT30M")).toBe(30 * 60_000);
  });

  it("rejects anything else", () => {
    expect(parseDuration("P")).toBeNull();
    expect(parseDuration("PT")).toBeNull();
    expect(parseDuration("PT0H")).toBeNull();
    expect(parseDuration("6 hours")).toBeNull();
  });
});

describe("parseGridAmounts", () => {
  it("converts to inches and skips blocks without a value", () => {
    const { snow, precip } = parseGridAmounts(jsonFixture("nws-gridpoints.json"));
    expect(snow).toHaveLength(9);
    expect(snow[2].value).toBeCloseTo(1, 5);
    expect(snow[6].end - snow[6].start).toBe(12 * 3600_000);
    expect(precip).toHaveLength(6);
    expect(precip[0].start).toBe(at("2026-10-13T18:00:00Z"));
  });

  it("ignores a layer in a unit it doesn't know", () => {
    expect(parseGridAmounts({ properties: { snowfallAmount: { uom: "wmoUnit:furlong", values: [] } } }).snow).toEqual([]);
  });
});

describe("amountBetween", () => {
  const blocks = [
    { start: 0, end: 6, value: 6 },
    { start: 6, end: 12, value: 3 },
  ];

  it("prorates blocks that straddle the window", () => {
    expect(amountBetween(blocks, 3, 9)).toBeCloseTo(4.5);
    expect(amountBetween(blocks, 0, 12)).toBeCloseTo(9);
  });

  it("is null unless the blocks cover the whole window", () => {
    expect(amountBetween(blocks, 6, 18)).toBeNull();
    expect(amountBetween([blocks[0], { start: 8, end: 12, value: 1 }], 0, 12)).toBeNull();
    expect(amountBetween([], 0, 1)).toBeNull();
  });
});

describe("buildDays", () => {
  const forecast = parsePeriods(jsonFixture("nws-forecast.json"));
  const grid = parseGridAmounts(jsonFixture("nws-gridpoints.json"));
  // 3 PM MDT, the start of "This Afternoon".
  const now = at("2026-10-13T21:00:00Z");

  it("pairs each day with the night after it", () => {
    const days = buildDays(forecast, grid, now);
    expect(days.map((d) => [d.date, d.name, d.high, d.low])).toEqual([
      ["2026-10-13", "This Afternoon", 45, 28],
      ["2026-10-14", "Wednesday", 33, 18],
      ["2026-10-15", "Thursday", 30, 15],
      ["2026-10-16", "Friday", 38, 22],
    ]);
    expect(days[0].precipChance).toBe(80);
    expect(days[2].precipChance).toBe(20);
    expect(days[3].precipChance).toBeNull();
  });

  it("sums snow and precipitation over each row's hours, from now on", () => {
    const [today, wednesday, thursday, friday] = buildDays(forecast, grid, now);
    // Half of the 0.24″ noon–6 PM block, then 1″ + 3″ overnight.
    expect(today.periods[0].snowIn).toBe(0.12);
    expect(today.periods[1].snowIn).toBe(4);
    expect(today.snowIn).toBe(4.12);
    expect(today.precipIn).toBe(0.55);
    // 2″ + 1″ by day, 1.2″ (a 12-hour block) overnight.
    expect(wednesday.snowIn).toBe(4.2);
    expect(wednesday.precipIn).toBe(0.5);
    // The snow grid stops at 6 PM Thursday: the day has an amount, the row doesn't.
    expect(thursday.periods[0].snowIn).toBe(0);
    expect(thursday.periods[1].snowIn).toBeNull();
    expect(thursday.snowIn).toBeNull();
    expect(thursday.precipIn).toBe(0);
    expect(friday.snowIn).toBeNull();
    expect(friday.precipIn).toBeNull();
  });

  it("starts with a night alone once the day is over, and drops ended periods", () => {
    const days = buildDays(forecast, grid, at("2026-10-14T01:00:00Z"));
    expect(days[0].name).toBe("Tonight");
    expect(days[0].high).toBeNull();
    expect(days[0].low).toBe(28);
    expect(days[0].periods).toHaveLength(1);
    // 7 PM onward: 5 of the 6 hours of the 1″ block, then 3″.
    expect(days[0].snowIn).toBeCloseTo(3.83, 2);
  });

  it("keeps the rows, without amounts, when the grid is missing", () => {
    const days = buildDays(forecast, null, now);
    expect(days).toHaveLength(4);
    expect(days.every((d) => d.snowIn === null && d.precipIn === null)).toBe(true);
  });
});

describe("forecastGlyph", () => {
  it("reads NWS's short wording", () => {
    expect(forecastGlyph("Snow Likely", false)).toBe("❄️");
    expect(forecastGlyph("Rain And Snow", true)).toBe("🌨️");
    expect(forecastGlyph("Chance Showers And Thunderstorms", true)).toBe("⛈️");
    expect(forecastGlyph("Mostly Cloudy", true)).toBe("☁️");
    expect(forecastGlyph("Partly Sunny", true)).toBe("⛅");
    expect(forecastGlyph("Mostly Clear", false)).toBe("🌙");
    expect(forecastGlyph("Sunny", true)).toBe("☀️");
  });
});

describe("dayGlyph and summary", () => {
  it("describe the whole row, so a sunny afternoon before a snowy night shows the snow", () => {
    const [today, , , friday] = buildDays(
      parsePeriods(jsonFixture("nws-forecast.json")),
      null,
      at("2026-10-13T21:00:00Z"),
    );
    expect(today.summary).toBe("Partly Sunny / Snow Likely");
    expect(dayGlyph(today)).toBe("❄️");
    expect(dayGlyph(friday)).toBe("☀️");
  });
});

describe("formatInches", () => {
  it("shows amounts, trace amounts, zero and no forecast distinctly", () => {
    expect(formatInches(6.24, 1)).toBe("6.2″");
    expect(formatInches(0.04, 1)).toBe("<0.1″");
    expect(formatInches(0.55, 2)).toBe("0.55″");
    expect(formatInches(0, 2)).toBe("0");
    expect(formatInches(null, 1)).toBe("—");
  });
});
