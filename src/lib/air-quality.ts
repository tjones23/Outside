import type { AirPollutant, AirQualitySite, LatLng } from "./types";

/**
 * Air quality from EPA AirNow's hourly observation files.
 *
 * Every hour AirNow publishes `HourlyAQObs_YYYYMMDDHH.dat`: one CSV row per
 * monitor — EPA, state, local and tribal networks, plus Canada and a few
 * others — with the AQI it reported for ozone, PM2.5, PM10 and NO2. The files
 * are plain public downloads, no key. An hour's file lands an hour or two
 * after the hour, and recent hours are republished as late data arrives.
 */

export const AIRNOW_ATTRIBUTION = "EPA AirNow";

const AIRNOW_FILES = "https://files.airnowtech.org/airnow";

/** The hour (top of the hour, UTC) `hoursAgo` before `now`, "YYYYMMDDHH". */
export function airNowHour(now: Date, hoursAgo = 0): string {
  return new Date(now.getTime() - hoursAgo * 3_600_000).toISOString().slice(0, 13).replace(/[-T]/g, "");
}

export function airNowUrl(hour: string): string {
  return `${AIRNOW_FILES}/${hour.slice(0, 4)}/${hour.slice(0, 8)}/HourlyAQObs_${hour}.dat`;
}

/** "2026101200" → ISO 8601. */
export function hourIso(hour: string): string {
  return `${hour.slice(0, 4)}-${hour.slice(4, 6)}-${hour.slice(6, 8)}T${hour.slice(8, 10)}:00:00.000Z`;
}

/**
 * Monitors outside North America (AirNow carries US embassies' and a few
 * countries' networks) are left out, like the hotspots.
 */
const BOUNDS = { south: 15, north: 72, west: -170, east: -50 };

/** Quoted CSV, as AirNow writes it: every field in quotes, `""` for a quote. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

const POLLUTANT_COLUMNS: [AirPollutant, string][] = [
  ["pm25", "PM25_AQI"],
  ["ozone", "OZONE_AQI"],
  ["pm10", "PM10_AQI"],
  ["no2", "NO2_AQI"],
];

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * One hour's file → every monitor in North America that reported an AQI.
 * A monitor's AQI is its worst pollutant's, the way AirNow reports it.
 */
export function parseAirNow(text: string, hour: string): AirQualitySite[] {
  const [header, ...rows] = parseCsv(text);
  if (!header?.includes("AQSID") || !header.includes("PM25_AQI")) {
    throw new Error("AirNow file has no AQSID / PM25_AQI header");
  }
  const col = (name: string) => header.indexOf(name);
  const at = {
    id: col("AQSID"),
    name: col("SiteName"),
    lat: col("Latitude"),
    lon: col("Longitude"),
    source: col("DataSource"),
    pm25: col("PM25"),
  };
  const pollutantAt = POLLUTANT_COLUMNS.map(([pollutant, name]) => [pollutant, col(name)] as const);
  const observed = hourIso(hour);

  return rows.flatMap((r): AirQualitySite[] => {
    const lat = num(r[at.lat]);
    const lon = num(r[at.lon]);
    if (lat === null || lon === null) return [];
    if (lat < BOUNDS.south || lat > BOUNDS.north || lon < BOUNDS.west || lon > BOUNDS.east) return [];

    const aqi: Partial<Record<AirPollutant, number>> = {};
    let worst: AirPollutant | null = null;
    for (const [pollutant, i] of pollutantAt) {
      const v = num(r[i]);
      if (v === null || v < 0) continue;
      aqi[pollutant] = Math.round(v);
      if (worst === null || v > aqi[worst]!) worst = pollutant;
    }
    if (worst === null) return [];
    // Monitors near zero read slightly negative; that's noise, not a reading worth showing.
    const pm25 = num(r[at.pm25]);

    return [
      {
        id: r[at.id] ?? "",
        name: (r[at.name] ?? "").trim() || "Monitor",
        coord: [lat, lon] as LatLng,
        aqi: aqi[worst]!,
        pollutant: worst,
        byPollutant: aqi,
        pm25: pm25 !== null && pm25 >= 0 ? pm25 : null,
        agency: (r[at.source] ?? "").trim() || null,
        observed,
      },
    ];
  });
}

// --- Display ------------------------------------------------------------------

/** EPA's AQI categories, with EPA's own colors. */
export const AQI_CATEGORIES: { max: number; label: string; color: string; text: string }[] = [
  { max: 50, label: "Good", color: "#00E400", text: "#111" },
  { max: 100, label: "Moderate", color: "#FFFF00", text: "#111" },
  { max: 150, label: "Unhealthy for sensitive groups", color: "#FF7E00", text: "#111" },
  { max: 200, label: "Unhealthy", color: "#FF0000", text: "#fff" },
  { max: 300, label: "Very unhealthy", color: "#8F3F97", text: "#fff" },
  { max: Infinity, label: "Hazardous", color: "#7E0023", text: "#fff" },
];

export function aqiCategory(aqi: number) {
  return AQI_CATEGORIES.find((c) => aqi <= c.max)!;
}

const POLLUTANT_NAMES: Record<AirPollutant, string> = {
  pm25: "PM2.5",
  ozone: "Ozone",
  pm10: "PM10",
  no2: "NO₂",
};

export function pollutantName(p: AirPollutant): string {
  return POLLUTANT_NAMES[p];
}

/** Worst first, for listing a monitor's readings. */
export function pollutantReadings(site: AirQualitySite): { pollutant: AirPollutant; aqi: number }[] {
  return POLLUTANT_COLUMNS.flatMap(([p]) => {
    const aqi = site.byPollutant[p];
    return aqi === undefined ? [] : [{ pollutant: p, aqi }];
  }).sort((a, b) => b.aqi - a.aqi);
}
