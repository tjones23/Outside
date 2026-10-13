import type { ForecastDay, ForecastPeriod } from "./types";

/**
 * The 7-day forecast for one spot, from the NWS API — what a saved place
 * shows when it's opened.
 *
 * Three requests, all keyless:
 *
 * - `/points/{lat},{lon}` names the forecast office and grid cell (about
 *   2.5 km) that cover the spot. That mapping practically never changes, so
 *   it's cached for weeks.
 * - The cell's `/forecast`: the forecasters' day and night periods —
 *   "Tonight: Snow. Low around 21. New snow accumulation of 4 to 8 inches."
 * - The cell's raw grid, for the numbers the text only words: new snow
 *   (`snowfallAmount`) and liquid precipitation (`quantitativePrecipitation`,
 *   which counts snow melted down), each in blocks of a few hours.
 *
 * Each row is one day period plus the night that follows it (6 AM to 6 AM,
 * NWS's own split), and the amounts are summed over exactly those hours, so
 * "Tuesday" carries Tuesday night's snow — the snow you'd find Wednesday
 * morning — just as the forecast text does.
 */

const NWS = "https://api.weather.gov";

/** The grid is ~2.5 km; three decimals (~100 m) keeps the cell while letting repeats share a cache entry. */
export function roundCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Valid coordinates, rounded; null for anything else. */
export function parseCoord(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  if (typeof lat !== "string" || typeof lon !== "string" || lat.trim() === "" || lon.trim() === "") return null;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  return { lat: roundCoord(la), lon: roundCoord(lo) };
}

export function pointsUrl(lat: number, lon: number): string {
  return `${NWS}/points/${roundCoord(lat)},${roundCoord(lon)}`;
}

/** True for URLs on the NWS API, the only host the forecast follows links to. */
export function isNwsUrl(url: string): boolean {
  return url.startsWith(`${NWS}/`);
}

// --- /points --------------------------------------------------------------------

export interface PointInfo {
  /** The cell's `/forecast` (day and night periods). */
  forecastUrl: string;
  /** The cell's raw grid. */
  gridUrl: string;
  /** NWS's nearest named place, "Alta, UT". */
  place: string | null;
}

export function parsePoint(json: unknown): PointInfo {
  const p = ((json as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>;
  const forecastUrl = typeof p.forecast === "string" ? p.forecast : null;
  const gridUrl = typeof p.forecastGridData === "string" ? p.forecastGridData : null;
  if (!forecastUrl || !gridUrl || !isNwsUrl(forecastUrl) || !isNwsUrl(gridUrl)) {
    throw new Error("NWS has no forecast grid for this spot");
  }
  const rel = (((p.relativeLocation as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>);
  const city = typeof rel.city === "string" ? rel.city : null;
  const state = typeof rel.state === "string" ? rel.state : null;
  return { forecastUrl, gridUrl, place: city ? (state ? `${city}, ${state}` : city) : null };
}

// --- /forecast ------------------------------------------------------------------

/** A period as NWS words it, before amounts are attached. */
export interface RawPeriod {
  name: string;
  /** ISO, with the place's own offset ("2026-10-14T06:00:00-06:00"). */
  start: string;
  end: string;
  isDaytime: boolean;
  /** °F. */
  temperature: number | null;
  /** Percent. */
  precipChance: number | null;
  short: string;
  detail: string;
}

export interface PeriodForecast {
  /** When the forecasters last issued it. */
  updated: string | null;
  periods: RawPeriod[];
}

/** NWS sends some values bare and some as `{ unitCode, value }`, depending on the API's feature flags. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object") return numberOf((value as Record<string, unknown>).value);
  return null;
}

export function parsePeriods(json: unknown): PeriodForecast {
  const p = ((json as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(p.periods) ? p.periods : [];
  const periods: RawPeriod[] = [];
  for (const item of raw) {
    const r = item as Record<string, unknown>;
    if (typeof r.startTime !== "string" || typeof r.endTime !== "string") continue;
    let temperature = numberOf(r.temperature);
    if (temperature !== null && r.temperatureUnit === "C") temperature = Math.round((temperature * 9) / 5 + 32);
    periods.push({
      name: typeof r.name === "string" ? r.name : "",
      start: r.startTime,
      end: r.endTime,
      isDaytime: r.isDaytime === true,
      temperature,
      precipChance: numberOf(r.probabilityOfPrecipitation),
      short: typeof r.shortForecast === "string" ? r.shortForecast : "",
      detail: typeof r.detailedForecast === "string" ? r.detailedForecast : "",
    });
  }
  const updated = typeof p.updateTime === "string" ? p.updateTime : typeof p.updated === "string" ? p.updated : null;
  return { updated, periods };
}

// --- The raw grid ---------------------------------------------------------------

/** One block of the grid: `value` inches over `[start, end)`, Unix ms. */
export interface AmountBlock {
  start: number;
  end: number;
  value: number;
}

export interface GridAmounts {
  /** New snow, inches. */
  snow: AmountBlock[];
  /** Liquid precipitation (rain plus melted snow and ice), inches. */
  precip: AmountBlock[];
}

/** ISO 8601 durations as NWS writes them — "PT6H", "P1D", "P1DT12H" — in ms. */
export function parseDuration(text: string): number | null {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(text);
  if (!m || text === "P" || text.endsWith("T")) return null;
  const [, d = "0", h = "0", min = "0"] = m;
  const ms = ((Number(d) * 24 + Number(h)) * 60 + Number(min)) * 60_000;
  return ms > 0 ? ms : null;
}

const TO_INCHES: Record<string, number> = {
  "wmoUnit:mm": 1 / 25.4,
  "wmoUnit:cm": 1 / 2.54,
  "wmoUnit:m": 1000 / 25.4,
  "wmoUnit:in": 1,
};

/** One grid layer — `{ uom, values: [{ validTime: "<iso>/PT6H", value }] }` — as blocks in inches. */
function parseLayer(layer: unknown): AmountBlock[] {
  const l = (layer ?? {}) as Record<string, unknown>;
  const factor = typeof l.uom === "string" ? TO_INCHES[l.uom] : undefined;
  if (factor === undefined || !Array.isArray(l.values)) return [];
  const out: AmountBlock[] = [];
  for (const item of l.values) {
    const v = item as Record<string, unknown>;
    if (typeof v.validTime !== "string" || typeof v.value !== "number" || !Number.isFinite(v.value)) continue;
    const [startText, durationText] = v.validTime.split("/");
    const start = Date.parse(startText);
    const duration = durationText ? parseDuration(durationText) : null;
    if (Number.isNaN(start) || duration === null) continue;
    out.push({ start, end: start + duration, value: Math.max(0, v.value) * factor });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function parseGridAmounts(json: unknown): GridAmounts {
  const p = ((json as Record<string, unknown>)?.properties ?? {}) as Record<string, unknown>;
  return { snow: parseLayer(p.snowfallAmount), precip: parseLayer(p.quantitativePrecipitation) };
}

/**
 * The amount over `[from, to)`, prorating blocks that straddle either end —
 * or null unless the blocks cover every minute of it. A gap means NWS hasn't
 * forecast that stretch (snow grids often stop days before the text does),
 * and a partial sum would read as a small forecast rather than a missing one.
 */
export function amountBetween(blocks: AmountBlock[], from: number, to: number): number | null {
  if (to <= from) return null;
  let total = 0;
  let coveredTo = from;
  for (const b of blocks) {
    if (b.end <= coveredTo) continue;
    if (b.start > coveredTo) return null;
    if (b.start >= to) break;
    const overlap = Math.min(b.end, to) - Math.max(b.start, coveredTo);
    total += (b.value * overlap) / (b.end - b.start);
    coveredTo = Math.min(b.end, to);
    if (coveredTo >= to) return total;
  }
  return null;
}

// --- Days -----------------------------------------------------------------------

const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

function sum(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/** Never mind a period that ended; for the one under way, count only what's left of it. */
function withAmounts(period: RawPeriod, grid: GridAmounts | null, now: number): ForecastPeriod | null {
  const end = Date.parse(period.end);
  const start = Math.max(Date.parse(period.start), now);
  if (Number.isNaN(end) || Number.isNaN(start) || end <= now) return null;
  return {
    ...period,
    snowIn: grid ? round2(amountBetween(grid.snow, start, end)) : null,
    precipIn: grid ? round2(amountBetween(grid.precip, start, end)) : null,
  };
}

/**
 * Periods → one row per day: a day period and the night after it. The first
 * row may be a night alone ("Tonight"). `date` is the local date the row
 * starts on, read off the period's own offset, so no time zone math is needed.
 */
export function buildDays(forecast: PeriodForecast, grid: GridAmounts | null, now: number): ForecastDay[] {
  const rows: ForecastPeriod[][] = [];
  for (const raw of forecast.periods) {
    const period = withAmounts(raw, grid, now);
    if (!period) continue;
    const last = rows.at(-1);
    if (!period.isDaytime && last?.length === 1 && last[0].isDaytime) last.push(period);
    else rows.push([period]);
  }
  return rows.map((periods) => {
    const day = periods.find((p) => p.isDaytime) ?? null;
    const night = periods.find((p) => !p.isDaytime) ?? null;
    const chances = periods.map((p) => p.precipChance).filter((c): c is number => c !== null);
    return {
      date: periods[0].start.slice(0, 10),
      name: periods[0].name,
      high: day?.temperature ?? null,
      low: night?.temperature ?? null,
      precipChance: chances.length > 0 ? Math.max(...chances) : null,
      summary: [...new Set(periods.map((p) => p.short).filter(Boolean))].join(" / "),
      snowIn: round2(sum(periods.map((p) => p.snowIn))),
      precipIn: round2(sum(periods.map((p) => p.precipIn))),
      periods,
    };
  });
}

/** A glyph for NWS's short forecast wording ("Chance Snow Showers", "Mostly Sunny"). */
export function forecastGlyph(short: string, isDaytime: boolean): string {
  const s = short.toLowerCase();
  if (/thunder|t-storm/.test(s)) return "⛈️";
  if (/snow|flurr|blizzard/.test(s)) return /rain|sleet|freezing|wintry/.test(s) ? "🌨️" : "❄️";
  if (/sleet|freezing|ice|wintry/.test(s)) return "🧊";
  if (/rain|shower|drizzle/.test(s)) return "🌧️";
  if (/fog|haze|smoke|dust/.test(s)) return "🌫️";
  if (/wind|breezy|blustery/.test(s)) return "💨";
  if (/partly|mostly sunny/.test(s)) return isDaytime ? "⛅" : "🌙";
  if (/cloudy|overcast/.test(s)) return "☁️";
  return isDaytime ? "☀️" : "🌙";
}

/** Most significant first: a row whose night brings snow shows snow, not its sunny afternoon. */
const GLYPH_RANK = ["⛈️", "❄️", "🌨️", "🧊", "🌧️", "🌫️", "💨", "☁️", "⛅", "☀️", "🌙"];

/** The glyph for a whole row, day and night. */
export function dayGlyph(day: ForecastDay): string {
  const glyphs = day.periods.map((p) => forecastGlyph(p.short, p.isDaytime));
  return glyphs.reduce((a, b) => (GLYPH_RANK.indexOf(b) < GLYPH_RANK.indexOf(a) ? b : a));
}
