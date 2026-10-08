/**
 * Build `public/borders.json`: the state and country lines the map draws over
 * radar and warnings.
 *
 * Esri's gray canvases bake these into the base tiles, faint and underneath
 * everything else. The map draws its own on top, all from Natural Earth's
 * 1:10m data: country land borders (via world-atlas's TopoJSON, shared edges
 * only — coastlines already show as land against water) and the state and
 * province lines of the US, Canada and Mexico.
 *
 * Borders don't move, so the output is committed; rerun this only to change
 * the source data or the simplification.
 *
 *   npm run build:borders
 */
import { writeFileSync } from "node:fs";
import { mesh } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";

const COUNTRIES = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-10m.json";
const STATES =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_1_states_provinces_lines.geojson";
/** Whose state and province lines to draw (Natural Earth's ADM0_A3 codes). */
const STATE_COUNTRIES = new Set(["USA", "CAN", "MEX"]);

/** Degrees. Drop vertices closer than this to the line (about 300 m). */
const TOLERANCE = 0.003;
/** Decimal places kept: 3 is about 100 m, finer than a line's width until zoom 11 or so. */
const PRECISION = 3;

type Point = [number, number];

/** Douglas–Peucker, iterative so a long border can't overflow the stack. */
function simplify(line: Point[], tolerance: number): Point[] {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = line[first];
    const [bx, by] = line[last];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    let farthest = -1;
    let max = tolerance;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = line[i];
      const d = length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / length;
      if (d > max) {
        max = d;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  return line.filter((_, i) => keep[i]);
}

const round = (n: number) => Number(n.toFixed(PRECISION));

/** Simplified, as Leaflet's [lat, lon] lines. */
function toLeaflet(lines: Point[][]): Point[][] {
  return lines
    .map((line) => simplify(line, TOLERANCE).map(([lon, lat]): Point => [round(lat), round(lon)]))
    .filter((line) => line.length >= 2);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function countryBorders(): Promise<Point[][]> {
  const topology = await fetchJson<Topology>(COUNTRIES);
  const shared = mesh(topology, topology.objects.countries as GeometryCollection, (a, b) => a !== b);
  return toLeaflet(shared.coordinates as Point[][]);
}

type LineFeature = {
  properties: { ADM0_A3: string | null };
  geometry: { type: "LineString"; coordinates: Point[] } | { type: "MultiLineString"; coordinates: Point[][] };
};

async function stateBorders(): Promise<Point[][]> {
  const { features } = await fetchJson<{ features: LineFeature[] }>(STATES);
  return toLeaflet(
    features
      .filter((f) => STATE_COUNTRIES.has(f.properties.ADM0_A3 ?? ""))
      .flatMap(({ geometry: g }) => (g.type === "LineString" ? [g.coordinates] : g.coordinates)),
  );
}

async function main(): Promise<void> {
  const [states, countries] = await Promise.all([stateBorders(), countryBorders()]);
  const json = JSON.stringify({ states, countries });
  writeFileSync("public/borders.json", json + "\n");

  const vertices = (lines: Point[][]) => lines.reduce((n, line) => n + line.length, 0);
  console.log(
    `public/borders.json: ${(json.length / 1024).toFixed(0)} KB — ` +
      `${states.length} state lines (${vertices(states)} points), ` +
      `${countries.length} country lines (${vertices(countries)} points)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
