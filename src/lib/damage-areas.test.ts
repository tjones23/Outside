import { describe, expect, it } from "vitest";
import { buildDamageAreas, severity01 } from "./damage-areas";
import { distanceMiles, polygonContains } from "./geo";
import { makeReport as report } from "./test-helpers";
import type { LatLng } from "./types";

/** Miles north of a point, roughly. */
const north = ([lat, lon]: LatLng, mi: number): LatLng => [lat + mi / 69, lon];
const origin: LatLng = [35, -97];

describe("buildDamageAreas", () => {
  it("turns a lone report into a circle eight miles round", () => {
    const [area] = buildDamageAreas([report("hail", origin)]);
    expect(area.ring).toHaveLength(16);
    for (const p of area.ring) expect(distanceMiles(origin, p)).toBeCloseTo(8, 0);
  });

  it("merges close reports into one capsule containing both", () => {
    const b = north(origin, 10);
    const areas = buildDamageAreas([report("wind", origin), report("wind", b)]);
    expect(areas).toHaveLength(1);
    expect(polygonContains(areas[0].ring, origin)).toBe(true);
    expect(polygonContains(areas[0].ring, b)).toBe(true);
  });

  it("keeps distant reports apart", () => {
    const areas = buildDamageAreas([report("wind", origin), report("wind", north(origin, 40))]);
    expect(areas).toHaveLength(2);
  });

  it("links a chain of reports each within reach of the next", () => {
    const a = origin;
    const b = north(a, 20);
    const c = north(b, 20);
    expect(buildDamageAreas([report("hail", a), report("hail", b), report("hail", c)])).toHaveLength(1);
  });

  it("never merges different categories", () => {
    const areas = buildDamageAreas([report("wind", origin), report("hail", origin)]);
    expect(areas.map((a) => a.category).sort()).toEqual(["hail", "wind"]);
  });

  it("takes the worst report's severity", () => {
    const [area] = buildDamageAreas([
      report("tornado", origin, { efRating: 1 }),
      report("tornado", north(origin, 5), { efRating: 4 }),
    ]);
    expect(area.severity).toBeCloseTo(0.8);
  });

  it("returns nothing for no reports", () => {
    expect(buildDamageAreas([])).toEqual([]);
  });
});

describe("severity01", () => {
  it("normalizes each category and clamps", () => {
    expect(severity01(report("hail", origin, { hailInches: 4.5 }))).toBe(1);
    expect(severity01(report("hail", origin, { hailInches: 0.25 }))).toBe(0);
    expect(severity01(report("wind", origin, { windMph: 75 }))).toBeCloseTo(0.5);
    expect(severity01(report("wind", origin, { windMph: 130 }))).toBe(1);
    expect(severity01(report("tornado", origin))).toBe(0);
  });
});
