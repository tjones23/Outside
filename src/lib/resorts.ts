import { distanceMiles, polygonContains } from "./geo";
import type { LatLng, Ring } from "./types";

/**
 * US ski resorts for the Places page, from `public/resorts.json` (built by
 * `scripts/build-resorts.ts` from OpenSkiMap, © OpenStreetMap contributors,
 * ODbL), and the state outlines that say which state the viewer is in
 * (`public/states.json`, from the US Census via us-atlas).
 */

export type SkiPass = "epic" | "ikon" | "independent";

export const SKI_PASSES: readonly SkiPass[] = ["epic", "ikon", "independent"];

/** The season the Epic and Ikon lists in the build script are for. */
export const PASS_SEASON = "2026–27";

export const PASS_LABEL: Record<SkiPass, string> = { epic: "Epic", ikon: "Ikon", independent: "Independent" };

export interface Resort {
  /** OpenSkiMap's id, stable across rebuilds. */
  id: string;
  name: string;
  /** Postal codes; more than one for a resort on a state line (Heavenly: CA, NV). */
  states: string[];
  lat: number;
  lon: number;
  pass: SkiPass;
  /** Lowest and highest lift or run, feet. */
  baseFt: number | null;
  topFt: number | null;
  website: string | null;
  /** The resort's own webcam page, where we know it. */
  webcams: string | null;
}

/** Each state's outline rings, [lat, lon]. */
export type StateShapes = Record<string, Ring[]>;

/** The state a point is in, or null offshore and outside the US. */
export function stateAt(shapes: StateShapes, point: LatLng): string | null {
  for (const [code, rings] of Object.entries(shapes)) {
    // Even-odd over all of a state's rings, so lakes and holes come out right.
    let inside = false;
    for (const ring of rings) if (polygonContains(ring, point)) inside = !inside;
    if (inside) return code;
  }
  return null;
}

/** The middle of the mountain, for picking a snow station at about the right height. */
export function midFt(resort: Resort): number | null {
  if (resort.baseFt === null || resort.topFt === null) return resort.topFt ?? resort.baseFt;
  return Math.round((resort.baseFt + resort.topFt) / 2);
}

export type ResortSort = "distance" | "custom";

export interface ResortQuery {
  state: string;
  /** Matched against the name, ignoring case and accents. */
  search: string;
  /** Empty means every pass. */
  passes: SkiPass[];
  sort: ResortSort;
  /** Resort ids in the viewer's order; others follow by distance. */
  order: string[];
  /** Where distances are measured from; without it, nearest-first falls back to A–Z. */
  from: LatLng | null;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export interface ResortRow {
  resort: Resort;
  miles: number | null;
}

/** The resorts in a state that match, in the order asked for. */
export function queryResorts(resorts: Resort[], q: ResortQuery): ResortRow[] {
  const needle = fold(q.search.trim());
  const rows = resorts
    .filter((r) => r.states.includes(q.state))
    .filter((r) => q.passes.length === 0 || q.passes.includes(r.pass))
    .filter((r) => !needle || fold(r.name).includes(needle))
    .map((resort) => ({ resort, miles: q.from ? distanceMiles(q.from, [resort.lat, resort.lon]) : null }));

  const byDistance = (a: ResortRow, b: ResortRow) =>
    a.miles !== null && b.miles !== null ? a.miles - b.miles : a.resort.name.localeCompare(b.resort.name);
  if (q.sort === "distance") return rows.sort(byDistance);

  const rank = new Map(q.order.map((id, i) => [id, i]));
  return rows.sort((a, b) => {
    const ra = rank.get(a.resort.id);
    const rb = rank.get(b.resort.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return byDistance(a, b);
  });
}

/**
 * `ids` (the list as shown) with `id` moved one place up or down. The result
 * is the whole shown list, so it becomes the stored order from then on.
 */
export function moveInOrder(ids: string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
