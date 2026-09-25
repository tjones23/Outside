import { describe, expect, it } from "vitest";
import { outerRings, polygons } from "./geojson";

const outer = [
  [-98, 35],
  [-97, 35],
  [-97, 36],
  [-98, 36],
  [-98, 35],
];
const hole = [
  [-97.6, 35.4],
  [-97.4, 35.4],
  [-97.4, 35.6],
  [-97.6, 35.4],
];

describe("polygons", () => {
  it("swaps GeoJSON [lon, lat] into [lat, lon]", () => {
    const [[ring]] = polygons({ type: "Polygon", coordinates: [outer] });
    expect(ring[0]).toEqual([35, -98]);
    expect(ring[1]).toEqual([35, -97]);
  });

  it("keeps holes, which outerRings drops", () => {
    const geometry = { type: "Polygon", coordinates: [outer, hole] };
    expect(polygons(geometry)[0]).toHaveLength(2);
    expect(outerRings(geometry)).toHaveLength(1);
  });

  it("reads every polygon of a MultiPolygon", () => {
    const geometry = { type: "MultiPolygon", coordinates: [[outer], [outer, hole]] };
    expect(polygons(geometry)).toHaveLength(2);
    expect(outerRings(geometry)).toHaveLength(2);
  });

  it("flattens a GeometryCollection, including an empty one", () => {
    expect(
      polygons({
        type: "GeometryCollection",
        geometries: [
          { type: "Polygon", coordinates: [outer] },
          { type: "MultiPolygon", coordinates: [[outer]] },
        ],
      }),
    ).toHaveLength(2);
    expect(polygons({ type: "GeometryCollection", geometries: [] })).toEqual([]);
  });

  it("returns nothing for null, points and garbage", () => {
    expect(polygons(null)).toEqual([]);
    expect(polygons({ type: "Point", coordinates: [-97, 35] })).toEqual([]);
    expect(polygons("nope")).toEqual([]);
  });
});
