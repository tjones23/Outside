import { describe, expect, it } from "vitest";
import {
  centroid,
  distanceMiles,
  miles,
  polygonContains,
  ringArea,
  ringsContain,
  simplifyLine,
  simplifyRing,
  withoutSpecks,
} from "./geo";
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

describe("simplifyLine", () => {
  it("drops points that don't change the shape, and keeps the ends", () => {
    const line: [number, number][] = [
      [0, 0],
      [0, 1],
      [0.001, 2],
      [0, 3],
      [5, 3],
    ];
    expect(simplifyLine(line, 0.01)).toEqual([
      [0, 0],
      [0, 3],
      [5, 3],
    ]);
  });

  it("keeps everything at zero tolerance", () => {
    const line: [number, number][] = [
      [0, 0],
      [0, 1],
      [0, 2],
    ];
    expect(simplifyLine(line, 0)).toBe(line);
  });
});

describe("simplifyRing", () => {
  it("returns null when too little is left to draw", () => {
    expect(
      simplifyRing(
        [
          [0, 0],
          [0, 0.001],
          [0, 0],
        ],
        0.01,
      ),
    ).toBeNull();
  });
});

describe("withoutSpecks", () => {
  const square = (half: number): Ring => [
    [-half, -half],
    [-half, half],
    [half, half],
    [half, -half],
  ];

  it("measures area in square degrees", () => {
    expect(ringArea(square(0.5))).toBeCloseTo(1);
  });

  it("drops tiny rings but always keeps the largest", () => {
    const big = square(1);
    const speck = square(0.0001);
    expect(withoutSpecks([speck, big, speck], 1e-5)).toEqual([big]);
    expect(withoutSpecks([speck], 1e-5)).toEqual([speck]);
  });
});
