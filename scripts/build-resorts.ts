/**
 * Build `public/resorts.json` (US ski resorts) and `public/states.json` (state
 * outlines, to tell which state the viewer is in).
 *
 * Resorts come from OpenSkiMap's ski area export, which is OpenStreetMap data
 * (© OpenStreetMap contributors, ODbL): every US ski area marked operating,
 * with downhill runs and at least one real lift (a magic carpet alone is a
 * tubing hill or a learning area). Which pass each takes is written down
 * below by hand for the season in `PASS_SEASON`; everything else is
 * "independent". The script fails if a pass entry matches no resort, so a
 * renamed area in OpenStreetMap is caught here rather than silently dropped.
 *
 * Resort ids are carried over from the existing `public/resorts.json`, so a
 * favorite saved under an id survives OpenSkiMap reissuing it.
 *
 * State outlines are the Census Bureau's 1:10m cartographic boundaries,
 * via us-atlas, simplified.
 *
 * Rerun before each season, after updating the pass lists:
 *
 *   npm run build:resorts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import { keepIds, PASS_SEASON, type Resort, type SkiPass } from "../src/lib/resorts";
import { stateCode } from "../src/lib/us-states";

const SKI_AREAS = "https://tiles.openskimap.org/geojson/ski_areas.geojson";
const STATES = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json";

const FT_PER_M = 3.281;
/** Degrees. Drop outline vertices closer than this to the line (about 1 km). */
const TOLERANCE = 0.01;
const PRECISION = 3;

/**
 * Epic and Ikon resorts by state and OpenStreetMap name, for `PASS_SEASON`.
 * Ikon's two-day bonus mountains count as Ikon. Sources: epicpass.com and
 * ikonpass.com resort lists, as summarized by OnTheSnow's 2026–27 buyer's
 * guides.
 */
const PASSES: Record<Exclude<SkiPass, "independent">, Record<string, string[]>> = {
  epic: {
    CA: ["Heavenly Mountain Resort", "Kirkwood Mountain Resort", "Northstar at Tahoe Resort"],
    CO: ["Vail", "Beaver Creek", "Breckenridge", "Keystone", "Crested Butte Mountain Resort", "Telluride Ski Area"],
    IN: ["Paoli Peaks"],
    MI: ["Mt Brighton"],
    MN: ["Afton Alps"],
    MO: ["Hidden Valley", "Snow Creek"],
    NH: ["Attitash Mountain Resort", "Crotched Mountain Ski & Ride", "Mount Sunapee", "Wildcat Mountain"],
    NY: ["Hunter Mountain"],
    OH: ["Alpine Valley", "Boston Mills Ski Resort", "Brandywine Ski Resort", "Mad River Mountain"],
    PA: [
      "Big Boulder Ski Resort Area", "Hidden Valley Resort", "Jack Frost Mountain Resort", "Laurel Mountain Ski Resort",
      "Liberty Mountain Resort", "Roundtop Mountain Resort", "Seven Springs Mountain Resort", "Whitetail Resort",
    ],
    UT: ["Park City Mountain Resort"],
    VT: ["Mount Snow", "Okemo Mountain", "Stowe Mountain Resort"],
    WA: ["Stevens Pass"],
    WI: ["Wilmot Mountain"],
  },
  ikon: {
    AK: ["Alyeska Resort"],
    CA: [
      "Palisades Tahoe Olympic Valley", "Palisades Tahoe Alpine Meadows", "Sierra-at-Tahoe Ski Resort", "Mammoth Mountain",
      "June Mountain", "Bear Mountain", "Snow Summit", "Snow Valley Mountain Resort",
    ],
    CO: [
      "Aspen Mountain", "Aspen Highlands", "Aspen Snowmass", "Buttermilk", "Steamboat Ski Resort", "Winter Park Resort",
      "Copper Mountain", "Arapahoe Basin", "Eldora",
    ],
    ID: ["Sun Valley - Bald Mountain", "Sun Valley - Dollar Mountain", "Schweitzer Mountain Resort", "Tamarack Resort"],
    MA: ["Jiminy Peak Resort", "Ski Butternut"],
    ME: ["Sunday River", "Sugarloaf"],
    MI: ["Boyne Mountain", "Boyne Highlands Resort", "Caberfae Peaks"],
    MN: ["Lutsen Mountains", "Wild Mountain", "Buck Hill"],
    MT: ["Big Sky Resort"],
    NH: ["Loon Mountain Resort", "Cranmore Mountain Resort"],
    NM: ["Taos Ski Valley"],
    OR: ["Mt. Bachelor"],
    PA: ["Camelback Mountain Resort"],
    UT: ["Alta Ski Area", "Snowbird", "Deer Valley Resort", "Solitude Mountain Resort", "Brighton Resort", "Snowbasin Resort"],
    VT: ["Killington Resort", "Pico Mountain Resort", "Stratton Mountain Resort", "Sugarbush Resort"],
    WA: ["Crystal Mountain", "Summit West", "Alpental"],
    WI: ["Granite Peak Ski Area", "Devil's Head Ski Area"],
    WV: ["Snowshoe Mountain"],
    WY: ["Jackson Hole Mountain Resort", "Snowy Range"],
  },
};

/** Private clubs and things that aren't ski areas, by name. */
const EXCLUDE = new Set(["Wasatch Peaks Ranch", "Yellowstone Club", "The Hermitage Club at Haystack Mountain", "Tubing Hill"]);

/** OpenStreetMap names that read badly in a list. */
const RENAME: Record<string, string> = {
  "Ski Santa Fe, Santa Fe, Q38555": "Ski Santa Fe",
  "Bromley Mountain Ski Resort;Bromley Mountain": "Bromley Mountain",
  "Summit West": "The Summit at Snoqualmie (West)",
  "Alpental": "The Summit at Snoqualmie (Alpental)",
};

/** Wrong or missing websites in OpenStreetMap. */
const WEBSITE: Record<string, string> = {
  Snowbird: "https://www.snowbird.com/",
  "Palisades Tahoe Alpine Meadows": "https://www.palisadestahoe.com/",
  "Roundtop Mountain Resort": "https://www.skiroundtop.com/",
  "Summit West": "https://www.summitatsnoqualmie.com/",
};

/** Every Vail Resorts mountain keeps its cams at the same path. */
const VAIL_CAMS = "/the-mountain/mountain-conditions/mountain-cams.aspx";

/**
 * Each resort's own webcam page, by state and OpenStreetMap name, looked up by
 * hand: there's no OpenStreetMap tag for it, and resorts don't share a URL
 * scheme. Epic and Ikon resorts so far; one that isn't here just shows its
 * website. `npm run check:webcams` finds the ones that have moved.
 */
const WEBCAMS: Record<string, string> = {
  "CA|Bear Mountain": "https://www.bigbearmountainresort.com/webcams",
  "CA|Heavenly Mountain Resort": `https://www.skiheavenly.com${VAIL_CAMS}`,
  "CA|June Mountain": "https://www.junemountain.com/mountain-information/live-cams",
  "CA|Kirkwood Mountain Resort": `https://www.kirkwood.com${VAIL_CAMS}`,
  "CA|Mammoth Mountain": "https://www.mammothmountain.com/on-the-mountain/mammoth-webcam",
  "CA|Northstar at Tahoe Resort": `https://www.northstarcalifornia.com${VAIL_CAMS}`,
  "CA|Palisades Tahoe Alpine Meadows": "https://www.palisadestahoe.com/mountain-information/webcams",
  "CA|Palisades Tahoe Olympic Valley": "https://www.palisadestahoe.com/mountain-information/webcams",
  "CA|Sierra-at-Tahoe Ski Resort": "https://sierraattahoe.com/live-cams/",
  "CA|Snow Summit": "https://www.bigbearmountainresort.com/webcams",
  "CO|Arapahoe Basin": "https://www.arapahoebasin.com/mountain-cams/",
  "CO|Aspen Highlands": "https://www.aspensnowmass.com/four-mountains/aspen-highlands/mountain-cams",
  "CO|Aspen Mountain": "https://www.aspensnowmass.com/four-mountains/aspen-mountain/mountain-cams",
  "CO|Aspen Snowmass": "https://www.aspensnowmass.com/four-mountains/snowmass/mountain-cams",
  "CO|Beaver Creek": `https://www.beavercreek.com${VAIL_CAMS}`,
  "CO|Breckenridge": `https://www.breckenridge.com${VAIL_CAMS}`,
  "CO|Buttermilk": "https://www.aspensnowmass.com/four-mountains/buttermilk/mountain-cams",
  "CO|Copper Mountain": "https://www.coppercolorado.com/the-mountain/webcams/",
  "CO|Crested Butte Mountain Resort": `https://www.skicb.com${VAIL_CAMS}`,
  "CO|Eldora": "https://www.eldora.com/the-mountain/current-conditions/webcams/",
  "CO|Keystone": `https://www.keystoneresort.com${VAIL_CAMS}`,
  "CO|Telluride Ski Area": "https://tellurideskiresort.com/webcams/",
  "CO|Vail": `https://www.vail.com${VAIL_CAMS}`,
  "CO|Winter Park Resort": "https://www.winterparkresort.com/the-mountain/mountain-cams",
  "ID|Schweitzer Mountain Resort": "https://www.schweitzer.com/mountain-info/webcam",
  "ID|Sun Valley - Bald Mountain": "https://www.sunvalley.com/the-mountain/web-cams",
  "ID|Sun Valley - Dollar Mountain": "https://www.sunvalley.com/the-mountain/web-cams",
  "ID|Tamarack Resort": "https://tamarackidaho.com/about/webcams",
  "IN|Paoli Peaks": `https://www.paolipeaks.com${VAIL_CAMS}`,
  "MA|Jiminy Peak Resort": "https://www.jiminypeak.com/webcams/",
  "ME|Sugarloaf": "https://www.sugarloaf.com/mountain-report",
  "ME|Sunday River": "https://www.sundayriver.com/mountain-report",
  "MI|Caberfae Peaks": "https://caberfaepeaks.com/live-cam-caberfae/",
  "MI|Mt Brighton": `https://www.mtbrighton.com${VAIL_CAMS}`,
  "MN|Afton Alps": `https://www.aftonalps.com${VAIL_CAMS}`,
  "MN|Buck Hill": "https://buckhill.com/skiing-snowboarding/webcams/",
  "MN|Lutsen Mountains": "https://www.lutsen.com/mountain-info/our-webcam",
  "MO|Hidden Valley": `https://www.hiddenvalleyski.com${VAIL_CAMS}`,
  "MO|Snow Creek": `https://www.skisnowcreek.com${VAIL_CAMS}`,
  "MT|Big Sky Resort": "https://www.bigskyresort.com/current-conditions/webcams",
  "NH|Attitash Mountain Resort": `https://www.attitash.com${VAIL_CAMS}`,
  "NH|Cranmore Mountain Resort": "https://cranmore.com/cams",
  "NH|Crotched Mountain Ski & Ride": `https://www.crotchedmtn.com${VAIL_CAMS}`,
  "NH|Loon Mountain Resort": "https://www.loonmtn.com/mountain-report",
  "NH|Mount Sunapee": `https://www.mountsunapee.com${VAIL_CAMS}`,
  "NH|Wildcat Mountain": `https://www.skiwildcat.com${VAIL_CAMS}`,
  "NM|Taos Ski Valley": "https://www.skitaos.com/weather",
  "NY|Hunter Mountain": `https://www.huntermtn.com${VAIL_CAMS}`,
  "OH|Alpine Valley": `https://www.alpinevalleyohio.com${VAIL_CAMS}`,
  "OH|Boston Mills Ski Resort": `https://www.bmbw.com${VAIL_CAMS}`,
  "OH|Brandywine Ski Resort": `https://www.bmbw.com${VAIL_CAMS}`,
  "OH|Mad River Mountain": `https://www.skimadriver.com${VAIL_CAMS}`,
  "OR|Mt. Bachelor": "https://www.mtbachelor.com/the-mountain/webcams/",
  "PA|Big Boulder Ski Resort Area": `https://www.jfbb.com${VAIL_CAMS}`,
  "PA|Hidden Valley Resort": `https://www.hiddenvalleyresort.com${VAIL_CAMS}`,
  "PA|Jack Frost Mountain Resort": `https://www.jfbb.com${VAIL_CAMS}`,
  "PA|Laurel Mountain Ski Resort": `https://www.laurelmountainski.com${VAIL_CAMS}`,
  "PA|Liberty Mountain Resort": `https://www.libertymountainresort.com${VAIL_CAMS}`,
  "PA|Roundtop Mountain Resort": `https://www.skiroundtop.com${VAIL_CAMS}`,
  "PA|Seven Springs Mountain Resort": `https://www.7springs.com${VAIL_CAMS}`,
  "PA|Whitetail Resort": `https://www.skiwhitetail.com${VAIL_CAMS}`,
  "UT|Alta Ski Area": "https://www.alta.com/weather",
  "UT|Brighton Resort": "https://www.brightonresort.com/conditions",
  "UT|Deer Valley Resort": "https://www.deervalley.com/explore-the-mountain/webcams",
  "UT|Park City Mountain Resort": `https://www.parkcitymountain.com${VAIL_CAMS}`,
  "UT|Snowbasin Resort": "https://www.snowbasin.com/the-mountain/web-cams/",
  "UT|Snowbird": "https://www.snowbird.com/the-mountain/webcams/view-all-webcams/",
  "UT|Solitude Mountain Resort": "https://www.solitudemountain.com/mountain-and-village/webcams",
  "VT|Killington Resort": "https://killington.com/webcams",
  "VT|Mount Snow": `https://www.mountsnow.com${VAIL_CAMS}`,
  "VT|Okemo Mountain": `https://www.okemo.com${VAIL_CAMS}`,
  "VT|Pico Mountain Resort": "https://picomountain.com/webcams",
  "VT|Stowe Mountain Resort": `https://www.stowe.com${VAIL_CAMS}`,
  "VT|Sugarbush Resort": "https://www.sugarbush.com/mountain/webcams",
  "WA|Alpental": "https://www.summitatsnoqualmie.com/webcams",
  "WA|Crystal Mountain": "https://www.crystalmountainresort.com/the-mountain/mountain-report-and-webcams/webcams",
  "WA|Stevens Pass": `https://www.stevenspass.com${VAIL_CAMS}`,
  "WA|Summit West": "https://www.summitatsnoqualmie.com/webcams",
  "WI|Granite Peak Ski Area": "https://www.skigranitepeak.com/mountain-info/live-web-cams",
  "WI|Wilmot Mountain": `https://www.wilmotmountain.com${VAIL_CAMS}`,
  "WY|Jackson Hole Mountain Resort": "https://www.jacksonhole.com/live-mountain-cams",
  "WY|Snowy Range": "https://snowyrangeski.com/webcams/",
};

type Position = [number, number];

interface SkiArea {
  properties: {
    id: string;
    name: string | null;
    status: string | null;
    activities: string[];
    places?: { iso3166_1Alpha2?: string; iso3166_2?: string }[];
    websites?: string[];
    statistics?: {
      minElevation?: number;
      maxElevation?: number;
      lifts?: { byType?: Record<string, { count: number }> };
    };
  };
  geometry:
    | { type: "Point"; coordinates: Position }
    | { type: "Polygon"; coordinates: Position[][] }
    | { type: "MultiPolygon"; coordinates: Position[][][] };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { "User-Agent": "Outside build-resorts (https://github.com/tjones23/Outside)" } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

const round = (n: number) => Number(n.toFixed(PRECISION));

/** The average of the outline's vertices: close enough to the lifts to measure a drive from. */
function center(geometry: SkiArea["geometry"]): Position {
  const points =
    geometry.type === "Point" ? [geometry.coordinates]
    : geometry.type === "Polygon" ? geometry.coordinates[0]
    : geometry.coordinates.flatMap((p) => p[0]);
  const lon = points.reduce((a, p) => a + p[0], 0) / points.length;
  const lat = points.reduce((a, p) => a + p[1], 0) / points.length;
  return [lon, lat];
}

function hasRealLift(area: SkiArea): boolean {
  const byType = area.properties.statistics?.lifts?.byType ?? {};
  return Object.entries(byType).some(([type, { count }]) => type !== "magic_carpet" && count > 0);
}

async function buildResorts(): Promise<Resort[]> {
  const { features } = await fetchJson<{ features: SkiArea[] }>(SKI_AREAS);
  const passOf = new Map<string, SkiPass>();
  for (const [pass, byState] of Object.entries(PASSES) as [SkiPass, Record<string, string[]>][]) {
    for (const [state, names] of Object.entries(byState)) for (const name of names) passOf.set(`${state}|${name}`, pass);
  }
  const matched = new Set<string>();
  const camsMatched = new Set<string>();

  const resorts: Resort[] = [];
  for (const area of features) {
    const p = area.properties;
    const states = [
      ...new Set(
        (p.places ?? []).filter((pl) => pl.iso3166_1Alpha2 === "US" && pl.iso3166_2).map((pl) => pl.iso3166_2!.slice(3)),
      ),
    ].sort();
    if (states.length === 0 || !p.name || EXCLUDE.has(p.name)) continue;
    if (p.status !== "operating" || !p.activities.includes("downhill") || !hasRealLift(area)) continue;

    let pass: SkiPass = "independent";
    let webcams: string | null = null;
    for (const state of states) {
      const key = `${state}|${p.name}`;
      const found = passOf.get(key);
      if (found) {
        pass = found;
        matched.add(key);
      }
      if (WEBCAMS[key]) {
        webcams = WEBCAMS[key];
        camsMatched.add(key);
      }
    }
    const [lon, lat] = center(area.geometry);
    const ft = (m: number | undefined) => (typeof m === "number" ? Math.round(m * FT_PER_M) : null);
    resorts.push({
      id: p.id,
      name: RENAME[p.name] ?? p.name,
      states,
      lat: round(lat),
      lon: round(lon),
      pass,
      baseFt: ft(p.statistics?.minElevation),
      topFt: ft(p.statistics?.maxElevation),
      website: WEBSITE[p.name] ?? p.websites?.[0] ?? null,
      webcams,
    });
  }

  const missing = [...passOf.keys()].filter((k) => !matched.has(k));
  if (missing.length > 0) throw new Error(`pass entries that match no resort: ${missing.join(", ")}`);
  const camsMissing = Object.keys(WEBCAMS).filter((k) => !camsMatched.has(k));
  if (camsMissing.length > 0) throw new Error(`webcam entries that match no resort: ${camsMissing.join(", ")}`);
  return resorts.sort((a, b) => a.name.localeCompare(b.name));
}

/** Douglas–Peucker, iterative so a long coastline can't overflow the stack. */
function simplify(line: Position[], tolerance: number): Position[] {
  if (line.length <= 4) return line;
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

type StateFeature = {
  properties: { name: string };
  geometry: { type: "Polygon"; coordinates: Position[][] } | { type: "MultiPolygon"; coordinates: Position[][][] };
};

async function buildStates(): Promise<Record<string, [number, number][][]>> {
  const topology = await fetchJson<Topology>(STATES);
  const { features } = feature(topology, topology.objects.states as GeometryCollection) as unknown as {
    features: StateFeature[];
  };
  const out: Record<string, [number, number][][]> = {};
  for (const f of features) {
    const code = stateCode(f.properties.name);
    if (!code) continue;
    const rings = f.geometry.type === "Polygon" ? f.geometry.coordinates : f.geometry.coordinates.flat();
    out[code] = rings
      .map((ring) => simplify(ring, TOLERANCE).map(([lon, lat]): [number, number] => [round(lat), round(lon)]))
      .filter((ring) => ring.length >= 4);
  }
  return out;
}

/** The resorts from the last build, whose ids favorites may hold. */
function previousResorts(): Resort[] {
  try {
    return (JSON.parse(readFileSync("public/resorts.json", "utf8")) as { resorts: Resort[] }).resorts;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const [built, states] = await Promise.all([buildResorts(), buildStates()]);
  const { resorts, carried } = keepIds(previousResorts(), built);
  for (const [old, r] of carried) {
    const renamed = old.name === r.name ? "" : ` (was ${old.name})`;
    console.log(`kept id for ${r.name}${renamed}: OpenSkiMap now calls it ${r.id}`);
  }
  const resortsJson = JSON.stringify({ season: PASS_SEASON, resorts });
  const statesJson = JSON.stringify(states);
  writeFileSync("public/resorts.json", resortsJson + "\n");
  writeFileSync("public/states.json", statesJson + "\n");

  const count = (pass: SkiPass) => resorts.filter((r) => r.pass === pass).length;
  console.log(
    `public/resorts.json: ${(resortsJson.length / 1024).toFixed(0)} KB — ${resorts.length} resorts ` +
      `(${count("epic")} Epic, ${count("ikon")} Ikon, ${count("independent")} independent)`,
  );
  console.log(`public/states.json: ${(statesJson.length / 1024).toFixed(0)} KB — ${Object.keys(states).length} states`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
