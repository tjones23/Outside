import { simplifyRing } from "./geo";
import type { LatLng, Ring, SmokeDensity, SmokePlume } from "./types";

/**
 * Smoke plumes from NOAA's Hazard Mapping System (HMS).
 *
 * NESDIS analysts outline smoke on GOES imagery through the day and publish
 * one KML per UTC day, growing as they work: each plume is a polygon with a
 * density (light, medium, heavy) and the window of satellite images it was
 * drawn from. The day's file appears some hours into the UTC day, so until it
 * does the previous day's stands in.
 */

export const HMS_ATTRIBUTION = "NOAA NESDIS Hazard Mapping System";

const HMS_KML = "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML";

/** "YYYY-MM-DD" (UTC) → that day's KML. */
export function smokeUrl(date: string): string {
  const [y, m, d] = date.split("-");
  return `${HMS_KML}/${y}/${m}/hms_smoke${y}${m}${d}.kml`;
}

/** The UTC date `daysAgo` days before `now`, "YYYY-MM-DD". */
export function utcDate(now: Date, daysAgo = 0): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Plume outlines are traced by hand at a few kilometers' precision; a
 * hundredth of a degree keeps their shape at a fraction of the points.
 */
const SIMPLIFY_DEG = 0.01;

const DENSITIES: Record<string, SmokeDensity> = { light: "light", medium: "medium", heavy: "heavy" };

/** HMS "2026283 1200UTC" (year, day of year, time) → ISO 8601. */
export function hmsTime(raw: string | undefined): string | null {
  const m = raw?.match(/(\d{4})(\d{3})\s+(\d{2})(\d{2})/);
  if (!m) return null;
  const [, year, doy, hh, mm] = m.map(Number);
  const ms = Date.UTC(year, 0, doy, hh, mm);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function field(description: string, name: string): string | undefined {
  return description.match(new RegExp(`${name}:\\s*([^<]+)`, "i"))?.[1]?.trim();
}

function parseCoordinates(block: string): Ring {
  const points: LatLng[] = [];
  for (const triple of block.trim().split(/\s+/)) {
    const [lon, lat] = triple.split(",").map(Number);
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lat, lon]);
  }
  return points;
}

/**
 * The plumes in one HMS KML. Only what HMS actually writes is handled — a
 * `Placemark` per plume, its density in the description and the style name,
 * outer boundaries only — so this is a few patterns, not an XML parser.
 */
export function parseSmokeKml(kml: string): SmokePlume[] {
  if (!/<kml[\s>]/.test(kml)) throw new Error("HMS answer is not KML");
  const plumes: SmokePlume[] = [];
  for (const [, body] of kml.matchAll(/<Placemark[^>]*>([\s\S]*?)<\/Placemark>/g)) {
    const description = body.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "";
    const style = body.match(/<styleUrl>#Smoke_(\w+?)(?:_style|_hl)?<\/styleUrl>/)?.[1] ?? "";
    const density = DENSITIES[(field(description, "Density") ?? style).toLowerCase()];
    if (!density) continue;

    const rings: Ring[] = [];
    for (const [, outer] of body.matchAll(/<outerBoundaryIs>([\s\S]*?)<\/outerBoundaryIs>/g)) {
      const coords = outer.match(/<coordinates>([\s\S]*?)<\/coordinates>/)?.[1];
      if (!coords) continue;
      const ring = simplifyRing(parseCoordinates(coords), SIMPLIFY_DEG, 3);
      if (ring) rings.push(ring);
    }
    if (rings.length === 0) continue;

    plumes.push({
      density,
      rings,
      start: hmsTime(field(description, "Start Time")),
      end: hmsTime(field(description, "End Time")),
      satellite: field(description, "Satellite") ?? null,
    });
  }
  return plumes;
}

/** Light first, so heavier smoke draws on top of the haze around it. */
const ORDER: SmokeDensity[] = ["light", "medium", "heavy"];

export function sortPlumes(plumes: SmokePlume[]): SmokePlume[] {
  return [...plumes].sort((a, b) => ORDER.indexOf(a.density) - ORDER.indexOf(b.density));
}

/** HMS's own green / yellow / red, which read as thin / thicker / thick smoke. */
export const SMOKE_DENSITIES: { density: SmokeDensity; label: string; color: string; fillOpacity: number }[] = [
  { density: "light", label: "Light smoke", color: "#9BD770", fillOpacity: 0.12 },
  { density: "medium", label: "Medium smoke", color: "#F2C14E", fillOpacity: 0.18 },
  { density: "heavy", label: "Heavy smoke", color: "#E8573C", fillOpacity: 0.26 },
];

export function smokeStyle(density: SmokeDensity) {
  return SMOKE_DENSITIES.find((d) => d.density === density)!;
}
