import { describe, expect, it } from "vitest";
import { circleRing, line, point, polygon } from "./map-features";

describe("map features", () => {
  it("flips [lat, lng] to GeoJSON's [lng, lat]", () => {
    expect(point([35, -97]).geometry.coordinates).toEqual([-97, 35]);
    expect(line([[35, -97], [36, -96]]).geometry.coordinates).toEqual([[-97, 35], [-96, 36]]);
  });

  it("closes polygon rings, once", () => {
    const open = polygon([[[35, -97], [35, -96], [36, -96]]]).geometry.coordinates[0];
    expect(open.at(-1)).toEqual(open[0]);
    expect(open).toHaveLength(4);
    const closed = polygon([[[35, -97], [35, -96], [36, -96], [35, -97]]]).geometry.coordinates[0];
    expect(closed).toHaveLength(4);
  });

  it("draws a circle the given distance from its center", () => {
    const ring = circleRing([40, -105], 10_000, 32);
    expect(ring).toHaveLength(33);
    // Due north, 10 km is about 0.09° of latitude.
    expect(ring[0][0] - 40).toBeCloseTo(0.0899, 3);
    expect(ring[0][1]).toBeCloseTo(-105, 6);
  });

});
