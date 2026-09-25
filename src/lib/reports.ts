import { hash53 } from "./hash";
import type { StormCategory, StormReport } from "./types";

/**
 * SPC storm reports. Ported from `SpcReportService.cs` and `StormReport.cs`.
 *
 * https://www.spc.noaa.gov/climo/reports/ — free, keyless CSV.
 *
 * ## Days
 *
 * SPC's report day is the *convective* day: 12Z to 12Z, named for the UTC
 * date it starts on. `today.csv` is the day in progress; each finished day is
 * published as `yyMMdd_rpts.csv`. The C# client computed file dates in
 * Chicago time and labels in the server's local time, which disagree with
 * each other and with SPC for part of every night — so between local
 * midnight and 12Z it could fetch the same day twice under two labels. Here
 * both come from one function, `convectiveDate`.
 */

const BASE = "https://www.spc.noaa.gov/climo/reports";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The convective day `offset` days before the current one, "YYYY-MM-DD". */
export function convectiveDate(now: Date, offset = 0): string {
  const d = new Date(now.getTime() - 12 * HOUR_MS - offset * DAY_MS);
  return d.toISOString().slice(0, 10);
}

export function reportsUrl(date: string, isToday: boolean): string {
  if (isToday) return `${BASE}/today.csv`;
  const [y, m, d] = date.split("-");
  return `${BASE}/${y.slice(2)}${m}${d}_rpts.csv`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Today", "Yesterday", or "Sep 22", relative to the current convective day. */
export function dayLabel(date: string, now: Date): string {
  const today = Date.parse(`${convectiveDate(now)}T00:00:00Z`);
  const then = Date.parse(`${date}T00:00:00Z`);
  const diff = Math.round((today - then) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  const [, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

function digits(s: string): number | null {
  const only = s.replace(/\D/g, "");
  return only.length === 0 ? null : parseInt(only, 10);
}

function isUnknown(magnitude: string): boolean {
  return magnitude === "" || magnitude.toUpperCase() === "UNK";
}

/** SPC reports hail in hundredths of an inch: "175" → "1.75". */
export function formatMagnitude(raw: string, category: StormCategory): string {
  const value = raw.trim();
  if (category !== "hail") return value;
  const hundredths = Number(value);
  return value !== "" && Number.isFinite(hundredths) ? (hundredths / 100).toFixed(2) : value;
}

export function reportTitle(category: StormCategory, magnitude: string): string {
  switch (category) {
    case "tornado":
      return isUnknown(magnitude) ? "Tornado" : `Tornado (${magnitude})`;
    case "hail":
      return isUnknown(magnitude) ? "Hail" : `Hail ${magnitude} in`;
    case "wind":
      return isUnknown(magnitude) ? "Wind damage" : `Wind ${magnitude} mph`;
  }
}

function tableCategory(header: string): StormCategory | null {
  const lower = header.toLowerCase();
  if (lower.includes("f_scale")) return "tornado";
  if (lower.includes("size")) return "hail";
  if (lower.includes("speed")) return "wind";
  return null;
}

/**
 * Parse one SPC report CSV.
 *
 * The file is three tables concatenated — tornado, hail, wind — each
 * introduced by a header row starting `Time,`. Columns: Time, magnitude,
 * Location, County, State, Lat, Lon, Comments. Comments may contain commas,
 * so everything from the eighth field on is rejoined.
 */
export function parseSpcCsv(csv: string, date: string): StormReport[] {
  const out: StormReport[] = [];
  const seen = new Set<string>();
  let category: StormCategory | null = null;

  for (const raw of csv.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("Time,")) {
      category = tableCategory(line);
      continue;
    }
    if (!category) continue;

    const f = line.split(",");
    if (f.length < 7) continue;
    const lat = Number(f[5]);
    const lon = Number(f[6]);
    if (f[5].trim() === "" || f[6].trim() === "" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      continue;
    }

    const time = f[0].trim();
    const magnitude = formatMagnitude(f[1], category);
    const location = f[2].trim();
    const county = f[3].trim();
    const state = f[4].trim();
    const comments = f.slice(7).join(",").trim();

    const id = hash53(`${date}|${category}|${time}|${lat}|${lon}|${location}|${comments}`);
    if (seen.has(id)) continue;
    seen.add(id);

    const numeric = digits(magnitude);
    const hail = Number(magnitude);
    out.push({
      id,
      category,
      time,
      magnitude,
      location,
      county,
      state,
      coord: [lat, lon],
      comments,
      date,
      title: reportTitle(category, magnitude),
      subtitle: [location, county && `${county} Co`, state].filter(Boolean).join(", "),
      windMph: category === "wind" ? numeric : null,
      hailInches: category === "hail" && magnitude !== "" && Number.isFinite(hail) ? hail : null,
      efRating: category === "tornado" ? numeric : null,
    });
  }
  return out;
}
