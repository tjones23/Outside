import { describe, expect, it } from "vitest";
import {
  columnMax,
  kucheraRatio,
  MAX_RATIO,
  MIN_RATIO,
  snowRatio,
  snowShare,
  standardPressure,
  warmestAloft,
  wetBulb,
  windFactor,
} from "./snow-ratio";

describe("wetBulb", () => {
  it("matches Stull's worked example", () => {
    expect(wetBulb(20, 50)).toBeCloseTo(13.7, 1);
  });

  it("equals the temperature when saturated, and sits below it when dry", () => {
    expect(wetBulb(0, 100)).toBeCloseTo(0, 0);
    expect(wetBulb(3, 40)).toBeLessThan(0.5);
  });
});

describe("snowShare", () => {
  const base = { warmestAloftC: null, modelShare: null };

  it("is snow when the wet-bulb is cold, rain when warm, a mix between", () => {
    expect(snowShare({ ...base, tempC: -5, rh: 90 })).toBe(1);
    expect(snowShare({ ...base, tempC: 6, rh: 95 })).toBe(0);
    const mix = snowShare({ ...base, tempC: 1.4, rh: 95 });
    expect(mix).toBeGreaterThan(0);
    expect(mix).toBeLessThan(1);
  });

  it("snows above freezing in dry air, where melting cools the flakes", () => {
    expect(snowShare({ ...base, tempC: 3, rh: 40 })).toBe(1);
  });

  it("melts flakes through a warm layer aloft", () => {
    expect(snowShare({ tempC: -2, rh: 90, warmestAloftC: 4, modelShare: null })).toBe(0);
    expect(snowShare({ tempC: -2, rh: 90, warmestAloftC: 2, modelShare: null })).toBeCloseTo(0.5);
    expect(snowShare({ tempC: -2, rh: 90, warmestAloftC: -6, modelShare: null })).toBe(1);
  });

  it("falls back to the model's own split, then to temperature alone", () => {
    expect(snowShare({ tempC: 0, rh: null, warmestAloftC: null, modelShare: 0.4 })).toBe(0.4);
    expect(snowShare({ tempC: -1, rh: null, warmestAloftC: null, modelShare: null })).toBe(1);
    expect(snowShare({ tempC: null, rh: null, warmestAloftC: null, modelShare: null })).toBe(0);
  });
});

describe("the column", () => {
  const levels = [
    { hPa: 1000, tempC: 4 },
    { hPa: 850, tempC: 1 },
    { hPa: 700, tempC: -8 },
    { hPa: 600, tempC: -11 },
    { hPa: 500, tempC: -20 },
  ];

  it("skips levels below the ground at a mountain site", () => {
    // 740 hPa is about 2,600 m: 1000 and 850 hPa are underground.
    expect(columnMax(levels, 740, -9)).toBe(-8);
    expect(warmestAloft(levels, 740)).toBe(-8);
  });

  it("counts everything above a low site, and the 2 m temperature", () => {
    expect(columnMax(levels, 1010, 2)).toBe(4);
    expect(columnMax(levels, 1010, 6)).toBe(6);
  });

  it("is null without levels", () => {
    expect(columnMax([], 900, -3)).toBeNull();
    expect(warmestAloft([], 900)).toBeNull();
  });

  it("estimates surface pressure from elevation", () => {
    expect(standardPressure(0)).toBeCloseTo(1013.25);
    expect(standardPressure(2655)).toBeCloseTo(732.4, 0);
  });
});

describe("kucheraRatio", () => {
  it("is 12:1 at −2 °C, rising one point per degree colder", () => {
    expect(kucheraRatio(-1.99)).toBeCloseTo(12, 1);
    expect(kucheraRatio(-12)).toBeCloseTo(22, 0);
  });

  it("falls two points per degree warmer", () => {
    expect(kucheraRatio(0)).toBeCloseTo(8, 0);
  });

  it("is clamped to believable ratios", () => {
    expect(kucheraRatio(-40)).toBe(MAX_RATIO);
    expect(kucheraRatio(10)).toBe(MIN_RATIO);
  });
});

describe("wind", () => {
  it("leaves light wind alone and packs snow in strong wind", () => {
    expect(windFactor(null)).toBe(1);
    expect(windFactor(3)).toBe(1);
    expect(windFactor(13.4)).toBeCloseTo(0.7);
    expect(windFactor(30)).toBeCloseTo(0.7);
    expect(snowRatio(-12, 20)).toBeCloseTo(22 * 0.7, 0);
  });
});
