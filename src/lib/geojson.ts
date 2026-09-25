import type { LatLng, Ring } from "./types";

/**
 * GeoJSON Polygon / MultiPolygon → rings. Ported from `GeoJson.cs`.
 *
 * This is the one place GeoJSON's `[lon, lat]` becomes our `[lat, lon]`.
 */

/** Each element is one polygon's rings: `[outer, hole1, hole2, …]`. */
export function polygons(geometry: unknown): Ring[][] {
  if (!geometry || typeof geometry !== "object") return [];
  const { type, coordinates, geometries } = geometry as {
    type?: unknown;
    coordinates?: unknown;
    geometries?: unknown;
  };

  // SPC wraps some products in a collection — an empty one when there is no
  // risk area at all ("Less Than 2% All Areas").
  if (type === "GeometryCollection") {
    return Array.isArray(geometries) ? geometries.flatMap(polygons) : [];
  }
  if (!Array.isArray(coordinates)) return [];

  switch (type) {
    case "Polygon":
      return [parsePolygon(coordinates)];
    case "MultiPolygon":
      return coordinates.filter(Array.isArray).map(parsePolygon);
    default:
      return [];
  }
}

/** The outer ring of each polygon, holes dropped. */
export function outerRings(geometry: unknown): Ring[] {
  return polygons(geometry)
    .filter((poly) => poly.length > 0)
    .map((poly) => poly[0]);
}

function parsePolygon(rings: unknown[]): Ring[] {
  return rings.filter(Array.isArray).map((ring) => {
    const points: LatLng[] = [];
    for (const pair of ring) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const [lon, lat] = pair;
      if (typeof lat === "number" && typeof lon === "number") points.push([lat, lon]);
    }
    return points;
  });
}
