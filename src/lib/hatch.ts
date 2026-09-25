import type { LatLng, Ring } from "./types";

/**
 * Diagonal hatch slashes inside polygons, as real geographic segments.
 *
 * Ported verbatim from `Hatch.cs` (itself from the iOS app). SPC marks
 * "conditional intensity" areas with hatching; a map has no pattern fill, so
 * each slash is drawn as a short line. Hole-aware, and snapped to a global
 * grid so nested areas share aligned slashes.
 */
export function hatchSegments(
  polys: Ring[][],
  referenceLatitude: number,
  spacingDegrees = 0.055,
  slashLengthDegrees = 0.03,
  angleDegrees = 45,
): [LatLng, LatLng][] {
  const out: [LatLng, LatLng][] = [];
  for (const rings of polys) {
    slashes(rings, referenceLatitude, spacingDegrees, slashLengthDegrees, angleDegrees, out);
  }
  return out;
}

function slashes(
  rings: Ring[],
  refLat: number,
  spacing: number,
  slashLength: number,
  angle: number,
  out: [LatLng, LatLng][],
): void {
  if (rings.length === 0 || rings[0].length < 3) return;

  const k = Math.max(0.1, Math.cos((refLat * Math.PI) / 180));
  const a = (-angle * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);

  // Rotate every ring into a frame where slashes run horizontally.
  const rotated = rings.map((ring) =>
    ring.map(([lat, lon]) => [lon * k * ca - lat * sa, lon * k * sa + lat * ca] as const),
  );

  const unrotate = (u: number, v: number): LatLng => [-u * sa + v * ca, (u * ca + v * sa) / k];

  // Even-odd point-in-polygon across all rings, so holes are excluded.
  const inside = (pu: number, pv: number): boolean => {
    let c = false;
    for (const ring of rotated) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [au, av] = ring[i];
        const [bu, bv] = ring[j];
        if (av > pv !== bv > pv) {
          const x = au + ((pv - av) / (bv - av)) * (bu - au);
          if (pu < x) c = !c;
        }
      }
    }
    return c;
  };

  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const ring of rotated) {
    for (const [u, v] of ring) {
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
  }

  const half = slashLength / 2;
  // Grid indices rather than accumulating `+= spacing`, so floating-point
  // drift can't knock separate areas off the shared grid.
  const v0 = Math.ceil(minV / spacing);
  const u0 = Math.ceil(minU / spacing);
  for (let vi = v0; vi * spacing <= maxV; vi++) {
    const v = vi * spacing;
    for (let ui = u0; ui * spacing <= maxU; ui++) {
      const u = ui * spacing;
      if (inside(u, v)) out.push([unrotate(u - half, v), unrotate(u + half, v)]);
    }
  }
}
