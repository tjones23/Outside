import { roundCoord } from "./point-forecast";
import { COLUMN_LEVELS } from "./snow-ratio";

/**
 * The weather models behind the snow blend, each fetched for one spot from
 * Open-Meteo — the same raw models OpenSnow blends (see its "how do you make
 * your forecasts" FAQ and 15-day forecast notes), served as point forecasts
 * so no GRIB files need downloading here.
 *
 * One request per model rather than one for all: a model that's down or
 * slow then costs only its own column of the blend, and each model's
 * response has plain variable names.
 *
 * Open-Meteo is free without a key for non-commercial use, under 10,000
 * calls a day; its data is CC BY 4.0 and must be credited (the snow panel
 * and About page do).
 */

const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
const ENSEMBLE_API = "https://ensemble-api.open-meteo.com/v1/ensemble";

export const OPEN_METEO_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";

/** Days asked of every model; each returns what it has (HRRR 2, ICON 7.5, GFS 16…). */
export const FORECAST_DAYS = 16;

/** Weight against lead time: [hours ahead, weight] points, straight lines between, flat past the ends. */
export type WeightCurve = readonly (readonly [number, number])[];

export interface BlendModel {
  /** Short key used in the payload and UI. */
  key: string;
  /** Open-Meteo's `models=` value. */
  id: string;
  name: string;
  maker: string;
  /** Grid spacing, km. */
  resolutionKm: number;
  kind: "deterministic" | "ensemble";
  weight: WeightCurve;
  /** Why it's weighted the way it is, for the About page. */
  role: string;
}

/**
 * The models, and how much each counts as the forecast reaches further out.
 *
 * These weights are Outside's judgment, written down so they can be argued
 * with: high-resolution models lead the first two days and then run out;
 * NBM (already bias-corrected) and ECMWF (the best-verifying global model)
 * carry the most weight among the rest; the AI models gain from day 3,
 * where they verify well; and the ensemble means take over from day 5,
 * where any single run is mostly noise. OpenSnow's own weights are
 * proprietary and tuned against verification data; these are not tuned.
 */
export const BLEND_MODELS: readonly BlendModel[] = [
  {
    key: "hrrr", id: "ncep_hrrr_conus", name: "HRRR", maker: "NOAA", resolutionKm: 3, kind: "deterministic",
    weight: [[0, 3], [18, 3], [48, 0]],
    role: "3 km, hourly runs; resolves individual ridges and lake-effect bands. Leads the first day, gone after two.",
  },
  {
    key: "hrdps", id: "cmc_gem_hrdps", name: "HRDPS", maker: "Environment Canada", resolutionKm: 2.5, kind: "deterministic",
    weight: [[0, 2.5], [24, 2.5], [48, 0]],
    role: "2.5 km, the other high-resolution short-range model. Strong the first day, gone after two.",
  },
  {
    key: "nbm", id: "ncep_nbm_conus", name: "NBM", maker: "NOAA", resolutionKm: 2.5, kind: "deterministic",
    weight: [[0, 2]],
    role: "The National Blend of Models: NOAA's own bias-corrected blend at 2.5 km, to 11 days.",
  },
  {
    key: "ecmwf", id: "ecmwf_ifs", name: "ECMWF IFS", maker: "ECMWF", resolutionKm: 9, kind: "deterministic",
    weight: [[0, 2]],
    role: "The European model at full 9 km resolution, the best-verifying global model. To 15 days.",
  },
  {
    key: "gfs", id: "ncep_gfs_global", name: "GFS", maker: "NOAA", resolutionKm: 13, kind: "deterministic",
    weight: [[0, 1]],
    role: "The American global model, to 16 days.",
  },
  {
    key: "icon", id: "dwd_icon_global", name: "ICON", maker: "DWD (Germany)", resolutionKm: 13, kind: "deterministic",
    weight: [[0, 1]],
    role: "The German global model, to 7.5 days.",
  },
  {
    key: "gdps", id: "cmc_gem_gdps", name: "GDPS", maker: "Environment Canada", resolutionKm: 15, kind: "deterministic",
    weight: [[0, 1]],
    role: "The Canadian global model, to 10 days.",
  },
  {
    key: "aifs", id: "ecmwf_aifs025_single", name: "ECMWF AIFS", maker: "ECMWF", resolutionKm: 25, kind: "deterministic",
    weight: [[0, 0.5], [72, 0.5], [120, 1.5]],
    role: "ECMWF's AI model. Coarse, but skilled at the large-scale pattern, so it gains weight from day 3.",
  },
  {
    key: "aigfs", id: "ncep_aigfs025", name: "AIGFS", maker: "NOAA", resolutionKm: 25, kind: "deterministic",
    weight: [[0, 0.5], [72, 0.5], [120, 1.5]],
    role: "NOAA's AI global model, built from DeepMind's GraphCast. Gains weight from day 3.",
  },
  {
    key: "gefs", id: "ncep_gefs_seamless", name: "GEFS ensemble", maker: "NOAA", resolutionKm: 25, kind: "ensemble",
    weight: [[0, 0], [120, 0], [216, 2]],
    role: "31 GFS runs with slightly different starts. Its spread is the forecast range; its mean takes over from day 5.",
  },
  {
    key: "aifsEns", id: "ecmwf_aifs025_ensemble", name: "AIFS ensemble", maker: "ECMWF", resolutionKm: 25, kind: "ensemble",
    weight: [[0, 0], [120, 0], [216, 2]],
    role: "51 runs of ECMWF's AI model. Range and, from day 5, its mean.",
  },
];

export function weightAt(curve: WeightCurve, leadHours: number): number {
  if (curve.length === 0) return 0;
  if (leadHours <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [h1, w1] = curve[i];
    if (leadHours <= h1) {
      const [h0, w0] = curve[i - 1];
      return w0 + ((w1 - w0) * (leadHours - h0)) / (h1 - h0);
    }
  }
  return curve[curve.length - 1][1];
}

// --- Requests -------------------------------------------------------------------

const SURFACE_VARS = ["temperature_2m", "relative_humidity_2m", "precipitation", "snowfall", "wind_speed_10m"];
const levelVar = (hPa: number) => `temperature_${hPa}hPa`;
const DETERMINISTIC_VARS = [...SURFACE_VARS, "surface_pressure", ...COLUMN_LEVELS.map(levelVar)];

function query(model: BlendModel, lat: number, lon: number, hourly: string[], past = false): string {
  return new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    hourly: hourly.join(","),
    models: model.id,
    ...(past ? { past_days: String(PAST_DAYS), forecast_days: "1" } : { forecast_days: String(FORECAST_DAYS) }),
    timezone: "auto",
    timeformat: "unixtime",
    wind_speed_unit: "ms",
  }).toString();
}

/** Days of the past the hindcast reaches back: 15 to total, and the start of the oldest 6 AM row. */
export const PAST_DAYS = 16;

/**
 * The models the 15-day hindcast reads: the ones that lead the blend's first
 * hours, plus GFS for a fourth opinion. Ensembles and the AI models only
 * matter days ahead; their past is no better than these.
 */
export const PAST_MODEL_KEYS = ["hrrr", "nbm", "ecmwf", "gfs"] as const;

/** A deterministic model's last `PAST_DAYS` days, through the end of today. */
export function pastModelUrl(model: BlendModel, lat: number, lon: number): string {
  return `${FORECAST_API}?${query(model, lat, lon, DETERMINISTIC_VARS, true)}`;
}

export function modelUrl(model: BlendModel, lat: number, lon: number): string {
  return model.kind === "ensemble"
    ? `${ENSEMBLE_API}?${query(model, lat, lon, SURFACE_VARS)}`
    : `${FORECAST_API}?${query(model, lat, lon, DETERMINISTIC_VARS)}`;
}

// --- Responses ------------------------------------------------------------------

type Series = (number | null)[];

/** One run's surface weather, hour by hour. Units: °C, %, mm, cm (Open-Meteo's 7:1 snow), m/s, hPa. */
export interface SurfaceSeries {
  tempC: Series;
  rh: Series;
  precipMm: Series;
  snowfallCm: Series;
  windMs: Series;
}

export interface DeterministicRun extends SurfaceSeries {
  kind: "deterministic";
  key: string;
  /** Unix ms, hourly. */
  times: number[];
  /** IANA zone of the spot. */
  timezone: string;
  /** The terrain height Open-Meteo corrected temperatures to, m. */
  elevation: number | null;
  surfaceHPa: Series;
  levels: { hPa: number; tempC: Series }[];
}

export interface EnsembleRun {
  kind: "ensemble";
  key: string;
  times: number[];
  timezone: string;
  elevation: number | null;
  members: SurfaceSeries[];
}

export type ModelRun = DeterministicRun | EnsembleRun;

function header(json: unknown): { hourly: Record<string, unknown>; times: number[]; timezone: string; elevation: number | null } {
  const j = (json ?? {}) as Record<string, unknown>;
  if (typeof j.error === "boolean" && j.error) throw new Error(`Open-Meteo: ${String(j.reason ?? "error")}`);
  const hourly = (j.hourly ?? {}) as Record<string, unknown>;
  const rawTimes = Array.isArray(hourly.time) ? hourly.time : [];
  const times = rawTimes.map((t) => (typeof t === "number" ? t * 1000 : NaN));
  if (times.length === 0 || times.some(Number.isNaN)) throw new Error("Open-Meteo answered without hourly times");
  return {
    hourly,
    times,
    timezone: typeof j.timezone === "string" ? j.timezone : "UTC",
    elevation: typeof j.elevation === "number" ? j.elevation : null,
  };
}

/** A column, or all nulls when the model doesn't have that variable. */
function series(hourly: Record<string, unknown>, key: string, length: number): Series {
  const raw = hourly[key];
  if (!Array.isArray(raw)) return new Array<null>(length).fill(null);
  return Array.from({ length }, (_, i) => (typeof raw[i] === "number" && Number.isFinite(raw[i]) ? (raw[i] as number) : null));
}

function surface(hourly: Record<string, unknown>, suffix: string, length: number): SurfaceSeries {
  return {
    tempC: series(hourly, `temperature_2m${suffix}`, length),
    rh: series(hourly, `relative_humidity_2m${suffix}`, length),
    precipMm: series(hourly, `precipitation${suffix}`, length),
    snowfallCm: series(hourly, `snowfall${suffix}`, length),
    windMs: series(hourly, `wind_speed_10m${suffix}`, length),
  };
}

export function parseDeterministic(model: BlendModel, json: unknown): DeterministicRun {
  const { hourly, times, timezone, elevation } = header(json);
  const n = times.length;
  return {
    kind: "deterministic",
    key: model.key,
    times,
    timezone,
    elevation,
    ...surface(hourly, "", n),
    surfaceHPa: series(hourly, "surface_pressure", n),
    levels: COLUMN_LEVELS.map((hPa) => ({ hPa, tempC: series(hourly, levelVar(hPa), n) })),
  };
}

/**
 * An ensemble's members. The control run comes as plain `precipitation`,
 * the rest as `precipitation_member01`…; a member counts only if it has
 * precipitation at all.
 */
export function parseEnsemble(model: BlendModel, json: unknown): EnsembleRun {
  const { hourly, times, timezone, elevation } = header(json);
  const suffixes = new Set<string>();
  for (const key of Object.keys(hourly)) {
    const m = /^precipitation(_member\d+)?$/.exec(key);
    if (m) suffixes.add(m[1] ?? "");
  }
  const members = [...suffixes]
    .sort()
    .map((suffix) => surface(hourly, suffix, times.length))
    .filter((m) => m.precipMm.some((v) => v !== null));
  if (members.length === 0) throw new Error(`Open-Meteo returned no ${model.name} members`);
  return { kind: "ensemble", key: model.key, times, timezone, elevation, members };
}

export function parseModelRun(model: BlendModel, json: unknown): ModelRun {
  return model.kind === "ensemble" ? parseEnsemble(model, json) : parseDeterministic(model, json);
}
