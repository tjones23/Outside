import type { Feature, FeatureCollection, Geometry, LineString, Point, Polygon } from "geojson";
import type { LatLng, Ring } from "./types";

/**
 * Outside's shapes as GeoJSON for MapLibre.
 *
 * Everything in the app is `[lat, lng]`; GeoJSON and MapLibre want
 * `[lng, lat]`. This is the one place that flips them.
 */

export type Props = Record<string, string | number | boolean | null>;

const lngLat = ([lat, lng]: LatLng): [number, number] => [lng, lat];

export function polygon(rings: Ring[], properties: Props = {}): Feature<Polygon, Props> {
  return {
    type: "Feature",
    properties,
    geometry: {
      type: "Polygon",
      coordinates: rings.map((ring) => {
        const out = ring.map(lngLat);
        // GeoJSON rings close on themselves; ours often don't.
        const [first, last] = [out[0], out.at(-1)];
        if (first && last && (first[0] !== last[0] || first[1] !== last[1])) out.push(first);
        return out;
      }),
    },
  };
}

export function line(points: LatLng[], properties: Props = {}): Feature<LineString, Props> {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates: points.map(lngLat) } };
}

export function point(at: LatLng, properties: Props = {}): Feature<Point, Props> {
  return { type: "Feature", properties, geometry: { type: "Point", coordinates: lngLat(at) } };
}

export function collection(features: Feature<Geometry, Props>[]): FeatureCollection<Geometry, Props> {
  return { type: "FeatureCollection", features };
}

export const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

const EARTH_RADIUS_M = 6_371_008.8;

/** A circle `radius` meters around `center`, as a ring of `steps` points. */
export function circleRing(center: LatLng, radius: number, steps = 64): Ring {
  const [lat, lng] = center;
  const d = radius / EARTH_RADIUS_M;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lng * Math.PI) / 180;
  const ring: Ring = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI]);
  }
  return ring;
}

