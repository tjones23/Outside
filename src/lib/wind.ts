import type { WindModelId } from "./types";

/**
 * Model wind fields → images a map can animate.
 *
 * Two free, keyless NOAA models, both fetched from NCEP's NOMADS grib filter,
 * which cuts a model's file down to the fields asked for (here the 10 m
 * winds, U and V) and repacks them with simple packing (template 5.0):
 *
 * - **GFS** — the global model at 0.25°, run every six hours. Outside draws
 *   every third hour out to five days, cut to North America by the filter.
 * - **HRRR** — the 3 km rapid-refresh model over the lower 48, run hourly out
 *   to 18 hours. Its grid is Lambert conformal and its winds are relative to
 *   that grid, so each point is projected and its wind rotated to true
 *   east/north. A run is ~4.7 MB a forecast hour, so only every third run is
 *   used — about 85 MB of downloads every three hours while someone watches.
 *
 * Both are resampled onto one regular lat/lon grid over `WIND_BOUNDS`, rows
 * north to south, and written as an RGB PNG a WebGL particle layer can sample
 * directly: R is U and G is V (m/s, scaled to 0–255 between the frame's own
 * minimum and maximum), and B is 255 where the model has data and 0 outside
 * its domain. Everything here is pure; `sources/wind-store.ts` does the
 * fetching and writing.
 */

export interface WindModelInfo {
  id: WindModelId;
  name: string;
  /** Who made it, for attribution. */
  source: string;
  /** Runs used start every this many hours (UTC, from 00Z). */
  runEveryHours: number;
  /** Forecast hours drawn from each run. */
  hours: readonly number[];
  /** Output grid spacing, degrees. */
  step: number;
}

const range = (from: number, to: number, by: number) =>
  Array.from({ length: Math.floor((to - from) / by) + 1 }, (_, k) => from + k * by);

export const WIND_MODELS: readonly WindModelInfo[] = [
  { id: "gfs", name: "GFS", source: "NOAA GFS via NOMADS", runEveryHours: 6, hours: range(0, 120, 3), step: 0.25 },
  { id: "hrrr", name: "HRRR", source: "NOAA HRRR via NOMADS", runEveryHours: 3, hours: range(0, 18, 1), step: 0.1 },
];

const BY_ID = new Map(WIND_MODELS.map((m) => [m.id, m]));

export function isWindModel(value: unknown): value is WindModelId {
  return typeof value === "string" && BY_ID.has(value as WindModelId);
}

export function windModel(id: WindModelId): WindModelInfo {
  return BY_ID.get(id)!;
}

/** Hours between a model's frames. */
export function frameStepHours(model: WindModelInfo): number {
  return model.hours[1] - model.hours[0];
}

/**
 * The area drawn, degrees: the lower 48 and their edges. HRRR's domain
 * reaches past it to the north-west and leaves the corners empty.
 */
export const WIND_BOUNDS = { west: -135, east: -60, south: 20, north: 55 } as const;

/**
 * How frames are drawn. Bump it whenever that changes (bounds, spacing,
 * encoding): the server then redraws instead of reusing old frames, and the
 * version in each frame URL keeps browsers from showing ones they cached.
 */
export const WIND_RENDER_VERSION = 1;

export const WIND_ATTRIBUTION = "NOAA GFS / HRRR";

// --- NOMADS -------------------------------------------------------------------

const NOMADS = "https://nomads.ncep.noaa.gov";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function runParts(run: number): { day: string; hour: string } {
  const d = new Date(run * 1000);
  return { day: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`, hour: pad(d.getUTCHours()) };
}

function fileName(model: WindModelId, run: number, hour: number): string {
  const t = runParts(run).hour;
  return model === "gfs" ? `gfs.t${t}z.pgrb2.0p25.f${pad(hour, 3)}` : `hrrr.t${t}z.wrfsfcf${pad(hour)}.grib2`;
}

function runDir(model: WindModelId, run: number): string {
  const { day, hour } = runParts(run);
  return model === "gfs" ? `/gfs.${day}/${hour}/atmos` : `/hrrr.${day}/conus`;
}

/** The 10 m U and V of one forecast hour, cut out by NOMADS's grib filter. */
export function windFileUrl(model: WindModelId, run: number, hour: number): string {
  const params = new URLSearchParams({
    dir: runDir(model, run),
    file: fileName(model, run, hour),
    var_UGRD: "on",
    var_VGRD: "on",
    lev_10_m_above_ground: "on",
  });
  if (model === "gfs") {
    // The filter wants longitudes 0–360. HRRR is already only the lower 48.
    params.set("subregion", "");
    params.set("toplat", String(WIND_BOUNDS.north));
    params.set("leftlon", String(WIND_BOUNDS.west + 360));
    params.set("rightlon", String(WIND_BOUNDS.east + 360));
    params.set("bottomlat", String(WIND_BOUNDS.south));
  }
  const script = model === "gfs" ? "filter_gfs_0p25.pl" : "filter_hrrr_2d.pl";
  return `${NOMADS}/cgi-bin/${script}?${params}`;
}

/**
 * The inventory of a run's last forecast hour. NCEP writes a run's files in
 * order, so once this exists the whole run does.
 */
export function windRunCheckUrl(model: WindModelId, run: number): string {
  const product = model === "gfs" ? "gfs" : "hrrr";
  const last = windModel(model).hours.at(-1)!;
  return `${NOMADS}/pub/data/nccf/com/${product}/prod${runDir(model, run)}/${fileName(model, run, last)}.idx`;
}

/** The `count` most recent run times (Unix seconds) at or before `nowMs`, newest first. */
export function recentRuns(model: WindModelInfo, nowMs: number, count: number): number[] {
  const step = model.runEveryHours * 3600;
  const newest = Math.floor(nowMs / 1000 / step) * step;
  return Array.from({ length: count }, (_, k) => newest - k * step);
}

/** A run's frames still worth drawing at `nowMs`: from the one just past onward. */
export function framesToDraw(model: WindModelInfo, run: number, nowMs: number): { hour: number; time: number }[] {
  const oldest = nowMs / 1000 - frameStepHours(model) * 3600;
  return model.hours.map((hour) => ({ hour, time: run + hour * 3600 })).filter((f) => f.time > oldest);
}

// --- GRIB2 ------------------------------------------------------------------

/** A regular lat/lon grid; `la1`/`lo1` is the first point, longitude in −180..180. */
export interface LatLonSource {
  kind: "latlon";
  ni: number;
  nj: number;
  la1: number;
  lo1: number;
  di: number;
  dj: number;
  /** Rows run north to south (scanning mode 0) rather than south to north (0x40). */
  northToSouth: boolean;
}

/** A Lambert conformal grid, as HRRR uses. Distances in meters, angles in degrees. */
export interface LambertSource {
  kind: "lambert";
  ni: number;
  nj: number;
  la1: number;
  lo1: number;
  lov: number;
  latin1: number;
  latin2: number;
  dx: number;
  dy: number;
  radius: number;
  northToSouth: boolean;
  /** U and V are along the grid's axes rather than true east and north. */
  gridRelative: boolean;
}

export type SourceGrid = LatLonSource | LambertSource;

export interface WindField {
  grid: SourceGrid;
  /** The model run (reference time), Unix seconds, and the forecast hour from it. */
  run: number;
  hour: number;
  /** m/s, in the grid's own order: rows along `nj`, points along `ni`. */
  u: Float32Array;
  v: Float32Array;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** GRIB2 writes signed integers as sign and magnitude, not two's complement. */
function signed(magnitude: number, bits: number): number {
  const sign = 2 ** (bits - 1);
  return magnitude >= sign ? -(magnitude - sign) : magnitude;
}

const lon180 = (lon: number) => (lon > 180 ? lon - 360 : lon);

/** Spherical radius for the earth shapes NCEP uses; anything else throws. */
function earthRadius(dv: DataView, at: number): number {
  const shape = dv.getUint8(at + 14);
  if (shape === 6) return 6371229;
  if (shape === 0) return 6367470;
  if (shape === 1) return dv.getUint32(at + 16) / 10 ** dv.getUint8(at + 15);
  throw new Error(`GRIB2 earth shape ${shape} isn't supported`);
}

function scanDirection(scanning: number): boolean {
  // Only row-by-row, west to east, non-alternating: 0 (north first) or 0x40 (south first).
  if ((scanning & ~0x40) !== 0) throw new Error(`GRIB2 scanning mode ${scanning} isn't supported`);
  return (scanning & 0x40) === 0;
}

function gridSection(dv: DataView, at: number): SourceGrid {
  const template = dv.getUint16(at + 12);
  const micro = (offset: number) => signed(dv.getUint32(at + offset), 32) / 1e6;
  if (template === 0) {
    return {
      kind: "latlon",
      ni: dv.getUint32(at + 30),
      nj: dv.getUint32(at + 34),
      la1: micro(46),
      lo1: lon180(micro(50)),
      di: dv.getUint32(at + 63) / 1e6,
      dj: dv.getUint32(at + 67) / 1e6,
      northToSouth: scanDirection(dv.getUint8(at + 71)),
    };
  }
  if (template === 30) {
    if (dv.getUint8(at + 63) !== 0) throw new Error("GRIB2 south-polar Lambert grids aren't supported");
    return {
      kind: "lambert",
      ni: dv.getUint32(at + 30),
      nj: dv.getUint32(at + 34),
      la1: micro(38),
      lo1: lon180(micro(42)),
      lov: lon180(micro(51)),
      latin1: micro(65),
      latin2: micro(69),
      dx: dv.getUint32(at + 55) / 1e3,
      dy: dv.getUint32(at + 59) / 1e3,
      radius: earthRadius(dv, at),
      northToSouth: scanDirection(dv.getUint8(at + 64)),
      gridRelative: (dv.getUint8(at + 46) & 0x08) !== 0,
    };
  }
  throw new Error(`GRIB2 grid template 3.${template} isn't supported`);
}

/** Unpack `count` simply-packed values of `bits` bits: (R + X · 2^E) / 10^D. */
export function unpackSimple(
  data: Uint8Array,
  count: number,
  bits: number,
  reference: number,
  binaryScale: number,
  decimalScale: number,
): Float32Array {
  const out = new Float32Array(count);
  const d = 10 ** -decimalScale;
  if (bits === 0) return out.fill(reference * d);
  if (bits > 24) throw new Error(`GRIB2 values of ${bits} bits aren't supported`);
  if (Math.ceil((count * bits) / 8) > data.length) throw new Error("GRIB2 data is shorter than its points");
  const e = 2 ** binaryScale;
  // A bit accumulator: never more than 31 bits held, since bits ≤ 24.
  let acc = 0, held = 0, at = 0;
  for (let k = 0; k < count; k++) {
    while (held < bits) {
      acc = (acc << 8) | data[at++];
      held += 8;
    }
    held -= bits;
    const x = acc >>> held;
    acc &= (1 << held) - 1;
    out[k] = (reference + x * e) * d;
  }
  return out;
}

function sameGrid(a: SourceGrid, b: SourceGrid): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The 10 m U and V in a filtered NOMADS file: one GRIB2 message each, on the
 * same grid, simple packing (5.0), no bitmap. Anything else throws rather
 * than drawing nonsense.
 */
export function parseWindGrib(bytes: Uint8Array): WindField {
  const dv = view(bytes);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 16 || text(0) !== "GRIB") throw new Error("not a GRIB2 file");
  let u: Float32Array | null = null, v: Float32Array | null = null;
  let grid: SourceGrid | null = null;
  let run = 0, hour = 0;

  let message = 0;
  while (message + 16 <= bytes.length && text(message) === "GRIB") {
    if (bytes[message + 7] !== 2) throw new Error("not a GRIB2 file");
    const total = Number(dv.getBigUint64(message + 8));
    const end = message + total;
    if (total < 20 || end > bytes.length) throw new Error("GRIB2 message runs past the end");

    let field: "u" | "v" | null = null;
    let msgGrid: SourceGrid | null = null;
    let packing: { count: number; reference: number; binaryScale: number; decimalScale: number; bits: number } | null = null;
    let values: Float32Array | null = null;

    let at = message + 16;
    while (at + 5 <= end && text(at) !== "7777") {
      const length = dv.getUint32(at);
      const section = bytes[at + 4];
      if (length < 5 || at + length > end) throw new Error("GRIB2 section runs past the end");
      if (section === 1) {
        run = Date.UTC(dv.getUint16(at + 12), bytes[at + 14] - 1, bytes[at + 15], bytes[at + 16], bytes[at + 17], bytes[at + 18]) / 1000;
      } else if (section === 3) {
        msgGrid = gridSection(dv, at);
      } else if (section === 4) {
        const template = dv.getUint16(at + 7);
        if (template !== 0) throw new Error(`GRIB2 product template 4.${template} isn't supported`);
        const category = bytes[at + 9], number = bytes[at + 10];
        // Momentum: 2 is U, 3 is V. The time unit must be hours (1).
        if (bytes[message + 6] === 0 && category === 2) field = number === 2 ? "u" : number === 3 ? "v" : null;
        if (bytes[at + 17] !== 1) throw new Error("GRIB2 forecast time isn't in hours");
        hour = dv.getUint32(at + 18);
      } else if (section === 5) {
        const template = dv.getUint16(at + 9);
        if (template !== 0) throw new Error(`GRIB2 packing template 5.${template} isn't supported`);
        packing = {
          count: dv.getUint32(at + 5),
          reference: dv.getFloat32(at + 11),
          binaryScale: signed(dv.getUint16(at + 15), 16),
          decimalScale: signed(dv.getUint16(at + 17), 16),
          bits: bytes[at + 19],
        };
      } else if (section === 6) {
        if (bytes[at + 5] !== 255) throw new Error("GRIB2 bitmaps aren't supported");
      } else if (section === 7) {
        if (!packing) throw new Error("GRIB2 data comes before its packing");
        const { count, bits, reference, binaryScale, decimalScale } = packing;
        values = unpackSimple(bytes.subarray(at + 5, at + length), count, bits, reference, binaryScale, decimalScale);
      }
      at += length;
    }

    if (field && msgGrid && values) {
      if (values.length !== msgGrid.ni * msgGrid.nj) throw new Error("GRIB2 data doesn't match its grid");
      if (grid && !sameGrid(grid, msgGrid)) throw new Error("U and V are on different grids");
      grid = msgGrid;
      if (field === "u") u = values;
      else v = values;
    }
    message = end;
  }

  if (!grid || !u || !v) throw new Error("GRIB2 file is missing U or V wind");
  return { grid, run, hour, u, v };
}

// --- Projection ---------------------------------------------------------------

const RAD = Math.PI / 180;

/** Fractional grid position (i along a row, j along `nj`) and wind rotation for a point. */
export interface GridPoint {
  i: number;
  j: number;
  /** Radians: earth U = cos·u + sin·v, earth V = −sin·u + cos·v. 0 for earth-relative winds. */
  angle: number;
}

/** A function from lat/lon to a source grid's coordinates. */
export function locator(grid: SourceGrid): (lat: number, lon: number) => GridPoint {
  if (grid.kind === "latlon") {
    return (lat, lon) => ({
      i: ((((lon - grid.lo1) % 360) + 360) % 360) / grid.di,
      j: (grid.northToSouth ? grid.la1 - lat : lat - grid.la1) / grid.dj,
      angle: 0,
    });
  }

  const φ1 = grid.latin1 * RAD, φ2 = grid.latin2 * RAD;
  const t = (φ: number) => Math.tan(Math.PI / 4 + φ / 2);
  const n = Math.abs(grid.latin1 - grid.latin2) < 1e-9 ? Math.sin(φ1) : Math.log(Math.cos(φ1) / Math.cos(φ2)) / Math.log(t(φ2) / t(φ1));
  const F = (Math.cos(φ1) * t(φ1) ** n) / n;
  const project = (lat: number, lon: number) => {
    const ρ = (grid.radius * F) / t(lat * RAD) ** n;
    const θ = n * ((((lon - grid.lov + 540) % 360) - 180) * RAD);
    return { x: ρ * Math.sin(θ), y: -ρ * Math.cos(θ), θ };
  };
  const origin = project(grid.la1, grid.lo1);
  return (lat, lon) => {
    const p = project(lat, lon);
    const dy = (p.y - origin.y) / grid.dy;
    return { i: (p.x - origin.x) / grid.dx, j: grid.northToSouth ? -dy : dy, angle: grid.gridRelative ? p.θ : 0 };
  };
}

// --- Output -------------------------------------------------------------------

/** Where a model's frames sit: pixel centers of the corners, and size. */
export interface WindImageGrid {
  west: number;
  north: number;
  step: number;
  width: number;
  height: number;
}

export function imageGrid(model: WindModelInfo): WindImageGrid {
  const { west, east, south, north } = WIND_BOUNDS;
  return {
    west,
    north,
    step: model.step,
    width: Math.round((east - west) / model.step) + 1,
    height: Math.round((north - south) / model.step) + 1,
  };
}

/** What a frame's bytes mean: U and V (m/s) at byte 0 and byte 255. */
export interface WindScale {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
}

export interface WindImage {
  width: number;
  height: number;
  /** RGB rows, each led by PNG's filter byte (0, none), ready to deflate. */
  scanlines: Uint8Array;
  scale: WindScale;
}

/**
 * Resample a field onto `out` (bilinear, rotated to true east/north) and
 * encode it. Points outside the model's grid get B = 0 and no wind.
 */
export function windImage(field: WindField, out: WindImageGrid): WindImage {
  const { grid } = field;
  const locate = locator(grid);
  const { width, height } = out;
  const us = new Float32Array(width * height), vs = new Float32Array(width * height);
  const valid = new Uint8Array(width * height);
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  const lastI = grid.ni - 1, lastJ = grid.nj - 1;
  const EDGE = 1e-6;

  for (let y = 0; y < height; y++) {
    const lat = out.north - y * out.step;
    for (let x = 0; x < width; x++) {
      const p = locate(lat, out.west + x * out.step);
      if (!(p.i >= -EDGE && p.i <= lastI + EDGE && p.j >= -EDGE && p.j <= lastJ + EDGE)) continue;
      const i0 = Math.min(Math.max(0, Math.floor(p.i)), Math.max(0, lastI - 1));
      const j0 = Math.min(Math.max(0, Math.floor(p.j)), Math.max(0, lastJ - 1));
      const i1 = Math.min(i0 + 1, lastI), j1 = Math.min(j0 + 1, lastJ);
      const wx = Math.min(1, Math.max(0, p.i - i0)), wy = Math.min(1, Math.max(0, p.j - j0));
      const a = j0 * grid.ni + i0, b = j0 * grid.ni + i1, c = j1 * grid.ni + i0, d = j1 * grid.ni + i1;
      const blend = (f: Float32Array) =>
        (1 - wx) * (1 - wy) * f[a] + wx * (1 - wy) * f[b] + (1 - wx) * wy * f[c] + wx * wy * f[d];
      let u = blend(field.u), v = blend(field.v);
      if (p.angle !== 0) {
        const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
        [u, v] = [cos * u + sin * v, -sin * u + cos * v];
      }
      const k = y * width + x;
      us[k] = u;
      vs[k] = v;
      valid[k] = 1;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }
  }
  if (uMin === Infinity) throw new Error("the model has no data inside the drawn area");
  // The scale goes out to the hundredth; widen it to that before encoding against it.
  [uMin, vMin] = [uMin, vMin].map((n) => Math.floor(n * 100) / 100);
  [uMax, vMax] = [uMax, vMax].map((n) => Math.ceil(n * 100) / 100);

  const byte = (value: number, min: number, max: number) => (max > min ? Math.round(((value - min) / (max - min)) * 255) : 0);
  const stride = 1 + 3 * width;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const k = y * width + x;
      if (!valid[k]) continue;
      const o = y * stride + 1 + 3 * x;
      rows[o] = byte(us[k], uMin, uMax);
      rows[o + 1] = byte(vs[k], vMin, vMax);
      rows[o + 2] = 255;
    }
  }
  return { width, height, scanlines: rows, scale: { uMin, uMax, vMin, vMax } };
}

export function windFrameUrl(model: WindModelId, time: number, run: number): string {
  return `/api/wind/${model}/${time}.png?run=${run}&v=${WIND_RENDER_VERSION}`;
}
