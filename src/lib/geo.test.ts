import { describe, expect, it } from "vitest";
import { centroid, distanceMiles, miles, polygonContains, ringsContain } from "./geo";
import type { Ring } from "./types";

const square: Ring = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
];

describe("polygonContains", () => {
  it("finds points inside and outside a square", () => {
    expect(polygonContains(square, [5, 5])).toBe(true);
    expect(polygonContains(square, [11, 5])).toBe(false);
    expect(polygonContains(square, [5, -1])).toBe(false);
  });

  it("handles a concave ring", () => {
    // A "U": the notch between the arms is outside.
    const u: Ring = [
      [0, 0],
      [10, 0],
      [10, 3],
      [2, 3],
      [2, 7],
      [10, 7],
      [10, 10],
      [0, 10],
    ];
    expect(polygonContains(u, [5, 5])).toBe(false);
    expect(polygonContains(u, [1, 5])).toBe(true);
    expect(polygonContains(u, [5, 1])).toBe(true);
  });

  it("never contains anything with two points or fewer", () => {
    expect(polygonContains([[0, 0], [1, 1]], [0.5, 0.5])).toBe(false);
  });

  it("checks every ring", () => {
    const far: Ring = square.map(([a, b]) => [a + 50, b + 50]);
    expect(ringsContain([square, far], [55, 55])).toBe(true);
    expect(ringsContain([square, far], [30, 30])).toBe(false);
  });
});

describe("distance", () => {
  it("measures Oklahoma City to Tulsa at about 100 miles", () => {
    const d = distanceMiles([35.4676, -97.5164], [36.154, -95.9928]);
    expect(d).toBeGreaterThan(95);
    expect(d).toBeLessThan(110);
  });

  it("converts meters to miles", () => {
    expect(miles(1609.344)).toBeCloseTo(1);
  });
});

describe("centroid", () => {
  it("averages the vertices", () => {
    expect(centroid(square)).toEqual([5, 5]);
    expect(centroid(undefined)).toBeNull();
    expect(centroid([])).toBeNull();
  });
});
