import { distanceMiles } from "./geo";
import type { DamageArea, LatLng, StormCategory, StormReport } from "./types";

/**
 * "Damage area" blobs synthesized from point reports. Ported from
 * `DamageAreas.cs`.
 *
 * Reports are points, so within each category nearby reports are clustered
 * and each cluster becomes one rounded polygon: the convex hull of its points
 * expanded by a fixed radius (a Minkowski sum with a disk, which stays convex).
 * A lone report becomes a circle; two become a capsule.
 */

/** Reports within this many miles of one another merge into one blob. */
const LINK_MILES = 25;
/** How far a blob extends around the reports it contains. */
const BUFFER_MILES = 8;
const MILES_PER_DEG_LAT = 69;

type Pt = [x: number, y: number];

export function buildDamageAreas(reports: StormReport[]): DamageArea[] {
  const byCategory = new Map<StormCategory, StormReport[]>();
  for (const r of reports) {
    const list = byCategory.get(r.category);
    if (list) list.push(r);
    else byCategory.set(r.category, [r]);
  }

  const areas: DamageArea[] = [];
  for (const [category, group] of byCategory) {
    for (const cluster of clusterReports(group)) {
      areas.push({
        category,
        ring: blob(cluster.map((r) => r.coord)),
        severity: Math.max(...cluster.map(severity01)),
      });
    }
  }
  return areas;
}

/** A report's magnitude normalized 0 (minor) – 1 (extreme). Unrated → 0. */
export function severity01(r: StormReport): number {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  switch (r.category) {
    // ~pea (0.25") up to a very large 4.5" stone.
    case "hail":
      return clamp(((r.hailInches ?? 0) - 0.25) / (4.5 - 0.25));
    // Severe-gust threshold (~50 mph) up to a violent ~100 mph.
    case "wind":
      return clamp(((r.windMph ?? 0) - 50) / (100 - 50));
    case "tornado":
      return clamp((r.efRating ?? 0) / 5);
  }
}

/** Single-linkage clustering: BFS over a "within LINK_MILES" graph. */
function clusterReports(reports: StormReport[]): StormReport[][] {
  const clusters: StormReport[][] = [];
  const visited = new Array<boolean>(reports.length).fill(false);
  for (let i = 0; i < reports.length; i++) {
    if (visited[i]) continue;
    visited[i] = true;
    const cluster: StormReport[] = [];
    const queue = [i];
    while (queue.length > 0) {
      const k = queue.shift()!;
      cluster.push(reports[k]);
      for (let j = 0; j < reports.length; j++) {
        if (visited[j]) continue;
        if (distanceMiles(reports[k].coord, reports[j].coord) <= LINK_MILES) {
          visited[j] = true;
          queue.push(j);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function blob(points: LatLng[]): LatLng[] {
  // Project to a local equirectangular plane in miles about the centroid, so
  // hull and buffer math is distortion-free at this scale.
  const lat0 = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lon0 = points.reduce((s, p) => s + p[1], 0) / points.length;
  let milesPerDegLon = MILES_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  if (Math.abs(milesPerDegLon) < 1e-6) milesPerDegLon = 1e-6;

  const projected = points.map(([lat, lon]): Pt => [
    (lon - lon0) * milesPerDegLon,
    (lat - lat0) * MILES_PER_DEG_LAT,
  ]);

  return buffer(convexHull(projected), BUFFER_MILES).map(([x, y]): LatLng => [
    lat0 + y / MILES_PER_DEG_LAT,
    lon0 + x / milesPerDegLon,
  ]);
}

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Andrew's monotone chain → counter-clockwise hull. */
export function convexHull(input: Pt[]): Pt[] {
  const pts = dedup(input);
  if (pts.length <= 2) return pts;
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Minkowski sum of a convex CCW polygon with a disk of radius r: each edge is
 * pushed out along its outward normal and the corners are filled with arcs.
 */
function buffer(poly: Pt[], r: number): Pt[] {
  const ring: Pt[] = [];
  const n = poly.length;
  if (n === 0) return ring;
  if (n === 1) {
    addArc(ring, poly[0], r, 0, 2 * Math.PI);
    return ring;
  }
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    const normal = outwardNormal(a, b);
    ring.push([a[0] + r * normal[0], a[1] + r * normal[1]]);
    ring.push([b[0] + r * normal[0], b[1] + r * normal[1]]);
    const next = outwardNormal(b, c);
    addArc(ring, b, r, Math.atan2(normal[1], normal[0]), Math.atan2(next[1], next[0]));
  }
  return ring;
}

function outwardNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [0, 0];
  // Right-hand normal is outward for a CCW polygon.
  return [dy / len, -dx / len];
}

/** A CCW arc sampled every 22.5°, excluding its start point. */
function addArc(ring: Pt[], center: Pt, r: number, from: number, to: number): void {
  while (to < from) to += 2 * Math.PI;
  const sweep = to - from;
  const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 8)));
  for (let s = 1; s <= steps; s++) {
    const angle = from + (sweep * s) / steps;
    ring.push([center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)]);
  }
}

function dedup(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!out.some((q) => Math.abs(q[0] - p[0]) < 0.05 && Math.abs(q[1] - p[1]) < 0.05)) {
      out.push([p[0], p[1]]);
    }
  }
  return out;
}
