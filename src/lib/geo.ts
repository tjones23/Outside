import type { LatLng, Ring } from "./types";

/** Geometry helpers, ported from DamageTracker's `Geo.cs`. */

const EARTH_RADIUS_M = 6_371_000;
const METERS_PER_MILE = 1609.344;

/**
 * Ray-casting point-in-polygon.
 *
 * Treats lat/lon as planar, which is accurate enough at the scale of a single
 * warning or outlook polygon.
 */
export function polygonContains(ring: Ring, [lat, lon]: LatLng): boolean {
  if (ring.length <= 2) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [aLat, aLon] = ring[i];
    const [bLat, bLon] = ring[j];
    if (aLat > lat !== bLat > lat) {
      const x = aLon + ((lat - aLat) / (bLat - aLat)) * (bLon - aLon);
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

/** True when any of the rings contains the point. */
export function ringsContain(rings: Ring[], point: LatLng): boolean {
  return rings.some((ring) => polygonContains(ring, point));
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function miles(meters: number): number {
  return meters / METERS_PER_MILE;
}

export function distanceMiles(a: LatLng, b: LatLng): number {
  return miles(distanceMeters(a, b));
}

/** Average of a ring's vertices — good enough for marker placement. */
export function centroid(ring: Ring | undefined): LatLng | null {
  if (!ring || ring.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const [a, b] of ring) {
    lat += a;
    lon += b;
  }
  return [lat / ring.length, lon / ring.length];
}

/** Continental US, `[[south, west], [north, east]]` — the default map view. */
export const US_BOUNDS: [LatLng, LatLng] = [
  [24.0, -125.0],
  [50.0, -66.5],
];

export const US_CENTER: LatLng = [39.5, -98.35];
