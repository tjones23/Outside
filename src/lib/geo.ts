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

/**
 * Douglas–Peucker, in degrees, keeping both ends. Zone outlines from NWS are
 * surveyed to the meter; at the zooms Outside is used at, a hundredth of a
 * degree (~1 km) is invisible and cuts a county from thousands of points to
 * dozens.
 */
export function simplifyLine(points: LatLng[], tolerance: number): LatLng[] {
  if (points.length <= 2 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [aLat, aLon] = points[first];
    const [bLat, bLon] = points[last];
    const dLat = bLat - aLat;
    const dLon = bLon - aLon;
    const len2 = dLat * dLat + dLon * dLon;
    let worst = -1;
    let worstD2 = tol2;
    for (let i = first + 1; i < last; i++) {
      const [pLat, pLon] = points[i];
      let t = len2 === 0 ? 0 : ((pLat - aLat) * dLat + (pLon - aLon) * dLon) / len2;
      t = Math.max(0, Math.min(1, t));
      const eLat = pLat - (aLat + t * dLat);
      const eLon = pLon - (aLon + t * dLon);
      const d2 = eLat * eLat + eLon * eLon;
      if (d2 > worstD2) {
        worst = i;
        worstD2 = d2;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** A ring simplified and rounded, or null when too little of it is left to draw. */
export function simplifyRing(ring: Ring, tolerance: number, digits = 3): Ring | null {
  const factor = 10 ** digits;
  const round = (v: number) => Math.round(v * factor) / factor;
  const out = simplifyLine(ring, tolerance).map(([lat, lon]): LatLng => [round(lat), round(lon)]);
  return out.length >= 4 ? out : null;
}

/** Planar area of a ring in square degrees (shoelace) — only for comparing sizes. */
export function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][1] * ring[i][0] - ring[i][1] * ring[j][0];
  }
  return Math.abs(sum) / 2;
}

/**
 * Drop specks: rings smaller than `minArea` square degrees, which simplified
 * coastlines leave behind by the thousand (rocks, sandbars, slivers) and
 * which would each cost the map an SVG path. The largest ring always stays,
 * so nothing loses its outline entirely.
 */
export function withoutSpecks(rings: Ring[], minArea: number): Ring[] {
  if (rings.length <= 1) return rings;
  const areas = rings.map(ringArea);
  const largest = areas.indexOf(Math.max(...areas));
  return rings.filter((_, i) => i === largest || areas[i] >= minArea);
}
