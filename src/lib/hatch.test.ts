import { describe, expect, it } from "vitest";
import { polygonContains } from "./geo";
import { hatchSegments } from "./hatch";
import type { LatLng, Ring } from "./types";

const square: Ring = [
  [35, -98],
  [35, -97],
  [36, -97],
  [36, -98],
  [35, -98],
];
const mid = ([a, b]: [LatLng, LatLng]): LatLng => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

describe("hatchSegments", () => {
  it("draws slashes whose midpoints lie inside the area", () => {
    const segs = hatchSegments([[square]], 35.5);
    expect(segs.length).toBeGreaterThan(50);
    for (const seg of segs) expect(polygonContains(square, mid(seg))).toBe(true);
  });

  it("draws nothing for a degenerate ring", () => {
    expect(hatchSegments([[[[35, -98], [36, -97]]]], 35.5)).toEqual([]);
    expect(hatchSegments([], 35.5)).toEqual([]);
  });

  it("leaves holes empty", () => {
    const hole: Ring = [
      [35.3, -97.7],
      [35.3, -97.3],
      [35.7, -97.3],
      [35.7, -97.7],
    ];
    const segs = hatchSegments([[square, hole]], 35.5);
    for (const seg of segs) expect(polygonContains(hole, mid(seg))).toBe(false);
    expect(segs.length).toBeLessThan(hatchSegments([[square]], 35.5).length);
  });

  it("puts separate areas on one shared grid", () => {
    // The same slash, found from two different polygons that both cover it.
    const bigger: Ring = square.map(([a, b]) => [a - 0.5 * Math.sign(35.5 - a), b]);
    const key = ([a]: [LatLng, LatLng]) => `${a[0].toFixed(9)},${a[1].toFixed(9)}`;
    const small = new Set(hatchSegments([[square]], 35.5).map(key));
    const large = new Set(hatchSegments([[bigger]], 35.5).map(key));
    for (const k of small) expect(large.has(k)).toBe(true);
  });
});
