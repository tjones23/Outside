import { PRECIP_SCALES, PRECIP_TYPE_STEP_SECONDS } from "./precip-type";

/**
 * NOAA MRMS → map tiles colored by precipitation type.
 *
 * MRMS (Multi-Radar Multi-Sensor, from NSSL, run operationally by NCEP)
 * mosaics every NEXRAD radar into one 0.01° grid over the continental US
 * every two minutes. Two of its products make a rain/snow radar:
 *
 * - **SeamlessHSR** — reflectivity (dBZ) from the lowest clear beam of any
 *   radar: how hard it is coming down.
 * - **PrecipFlag** — what is coming down, per grid cell, which MRMS works out
 *   from the radar data and model temperature analyses. The codes used here:
 *   1 warm stratiform rain,
 *   3 snow, 6 convective rain, 7 rain mixed with hail, 10 cool stratiform
 *   rain, 91 tropical/stratiform rain mix, 96 tropical/convective rain mix;
 *   0 is no precipitation and −3 no radar coverage. There is no sleet or
 *   freezing-rain class.
 *
 * Both arrive as one-message GRIB2 files whose data section is a PNG
 * (packing template 5.41), so decoding needs nothing but inflate. Everything
 * here is pure — no I/O and no zlib — so it runs anywhere and tests easily;
 * `sources/mrms-store.ts` does the fetching, inflating and writing.
 */

export const MRMS_BASE_URL = "https://mrms.ncep.noaa.gov/2D";
export type MrmsProduct = "PrecipFlag" | "SeamlessHSR";

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `MRMS_PrecipFlag_00.00_20261008-014000.grib2.gz` for a frame time (Unix seconds). */
export function mrmsFileUrl(product: MrmsProduct, time: number): string {
  const d = new Date(time * 1000);
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${MRMS_BASE_URL}/${product}/MRMS_${product}_00.00_${stamp}.grib2.gz`;
}

/** The `count` most recent frame times at or before `nowMs`, newest first. */
export function recentFrameTimes(nowMs: number, count: number): number[] {
  const step = PRECIP_TYPE_STEP_SECONDS;
  const newest = Math.floor(nowMs / 1000 / step) * step;
  return Array.from({ length: count }, (_, k) => newest - k * step);
}

// --- GRIB2 ------------------------------------------------------------------

/** A regular latitude/longitude grid, rows north to south, columns west to east. */
export interface LatLonGrid {
  ni: number;
  nj: number;
  /** Center of the first (north-west) cell, degrees; longitude in −180..180. */
  la1: number;
  lo1: number;
  di: number;
  dj: number;
}

export interface GribField {
  grid: LatLonGrid;
  /** value = (R + X · 2^E) / 10^D, for each stored integer X. */
  reference: number;
  binaryScale: number;
  decimalScale: number;
  /** The packed values, as a PNG image. */
  png: Uint8Array;
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** GRIB2 writes signed integers as sign and magnitude, not two's complement. */
function signed(magnitude: number, bits: number): number {
  const sign = 2 ** (bits - 1);
  return magnitude >= sign ? -(magnitude - sign) : magnitude;
}

/**
 * The first field of a GRIB2 file. Only what MRMS uses is supported — a
 * lat/lon grid (template 3.0) scanned north to south, PNG packing (5.41) and
 * no bitmap — and anything else throws rather than drawing nonsense.
 */
export function parseGrib2(bytes: Uint8Array): GribField {
  const dv = view(bytes);
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 16 || text(0) !== "GRIB" || bytes[7] !== 2) throw new Error("not a GRIB2 file");

  let grid: LatLonGrid | null = null;
  let scale: { reference: number; binaryScale: number; decimalScale: number } | null = null;
  let png: Uint8Array | null = null;

  let at = 16;
  while (at + 5 <= bytes.length && text(at) !== "7777") {
    const length = dv.getUint32(at);
    const section = bytes[at + 4];
    if (length < 5 || at + length > bytes.length) throw new Error("GRIB2 section runs past the end");

    if (section === 3) {
      const template = dv.getUint16(at + 12);
      if (template !== 0) throw new Error(`GRIB2 grid template 3.${template} isn't supported`);
      const scanning = bytes[at + 71];
      if (scanning !== 0) throw new Error(`GRIB2 scanning mode ${scanning} isn't supported`);
      const lo1 = dv.getUint32(at + 50) / 1e6;
      grid = {
        ni: dv.getUint32(at + 30),
        nj: dv.getUint32(at + 34),
        la1: signed(dv.getUint32(at + 46), 32) / 1e6,
        lo1: lo1 > 180 ? lo1 - 360 : lo1,
        di: dv.getUint32(at + 63) / 1e6,
        dj: dv.getUint32(at + 67) / 1e6,
      };
    } else if (section === 5) {
      const template = dv.getUint16(at + 9);
      if (template !== 41) throw new Error(`GRIB2 packing template 5.${template} isn't supported`);
      scale = {
        reference: dv.getFloat32(at + 11),
        binaryScale: signed(dv.getUint16(at + 15), 16),
        decimalScale: signed(dv.getUint16(at + 17), 16),
      };
    } else if (section === 6) {
      if (bytes[at + 5] !== 255) throw new Error("GRIB2 bitmaps aren't supported");
    } else if (section === 7) {
      png = bytes.subarray(at + 5, at + length);
      break;
    }
    at += length;
  }

  if (!grid || !scale || !png) throw new Error("GRIB2 file is missing its grid, packing or data");
  return { grid, ...scale, png };
}

/** Every value a stored integer of `bits` bits can decode to, by integer. */
function decodeAll(field: GribField, bits: number): Float64Array {
  const out = new Float64Array(2 ** bits);
  const e = 2 ** field.binaryScale;
  const d = 10 ** -field.decimalScale;
  for (let x = 0; x < out.length; x++) out[x] = (field.reference + x * e) * d;
  return out;
}

// --- PNG (the packed data) ----------------------------------------------------

export interface PngImage {
  width: number;
  height: number;
  /** 8 or 16: grayscale is all GRIB2 PNG packing uses for one field. */
  bitDepth: number;
  /** The concatenated IDAT payload, still deflated. */
  idat: Uint8Array;
}

export function readPng(png: Uint8Array): PngImage {
  const dv = view(png);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (png.length < 33 || signature.some((b, i) => png[i] !== b)) throw new Error("not a PNG");

  let width = 0, height = 0, bitDepth = 0;
  const parts: Uint8Array[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = dv.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view(data).getUint32(0);
      height = view(data).getUint32(4);
      bitDepth = data[8];
      const colorType = data[9], interlace = data[12];
      if (colorType !== 0 || interlace !== 0 || (bitDepth !== 8 && bitDepth !== 16)) {
        throw new Error(`PNG with color type ${colorType}, depth ${bitDepth}, interlace ${interlace} isn't supported`);
      }
    } else if (type === "IDAT") {
      parts.push(data);
    } else if (type === "IEND") {
      break;
    }
    at += 12 + length;
  }
  if (!width || !height || parts.length === 0) throw new Error("PNG has no image data");

  const idat = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    idat.set(p, offset);
    offset += p.length;
  }
  return { width, height, bitDepth, idat };
}

/**
 * Inflated PNG scanlines with the filters undone in place: row y's samples
 * start at `y * (stride + 1) + 1`, big-endian when 16-bit. Undoing the
 * filters in place avoids a second copy of a 50 MB image.
 */
export interface Samples {
  width: number;
  height: number;
  bitDepth: number;
  stride: number;
  data: Uint8Array;
}

export function samplesOf(image: Omit<PngImage, "idat">, inflated: Uint8Array): Samples {
  const { width, height, bitDepth } = image;
  const stride = width * (bitDepth / 8);
  if (inflated.length < (stride + 1) * height) throw new Error("PNG data is shorter than its size");
  return { width, height, bitDepth, stride, data: inflated };
}

/**
 * Undo the filters on rows `y0` up to `y1`. Each row depends on the one
 * above, so bands must go top to bottom; splitting them up lets the caller
 * yield in between.
 */
export function unfilterRows(samples: Samples, y0 = 0, y1 = samples.height): Samples {
  const { stride, data: d } = samples;
  const bpp = samples.bitDepth / 8;
  for (let y = y0; y < y1; y++) {
    const row = y * (stride + 1);
    const filter = d[row];
    const cur = row + 1;
    const prev = cur - (stride + 1);
    const up = y > 0;
    switch (filter) {
      case 0:
        break;
      case 1:
        for (let x = bpp; x < stride; x++) d[cur + x] = (d[cur + x] + d[cur + x - bpp]) & 255;
        break;
      case 2:
        if (up) for (let x = 0; x < stride; x++) d[cur + x] = (d[cur + x] + d[prev + x]) & 255;
        break;
      case 3:
        for (let x = 0; x < stride; x++) {
          const a = x >= bpp ? d[cur + x - bpp] : 0;
          const b = up ? d[prev + x] : 0;
          d[cur + x] = (d[cur + x] + ((a + b) >> 1)) & 255;
        }
        break;
      case 4:
        for (let x = 0; x < stride; x++) {
          const a = x >= bpp ? d[cur + x - bpp] : 0;
          const b = up ? d[prev + x] : 0;
          const c = up && x >= bpp ? d[prev + x - bpp] : 0;
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          d[cur + x] = (d[cur + x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
        break;
      default:
        throw new Error(`PNG filter ${filter} isn't valid`);
    }
  }
  return samples;
}

// --- Classification -----------------------------------------------------------

/** Steps per kind in the palette: 5 dBZ wide, 5 to 70+. */
export const DBZ_STEPS = 14;
const SNOW_OFFSET = DBZ_STEPS;
/** Palette index 0 is transparent; 1–14 rain by intensity; 15–28 snow. */
export const PALETTE_SIZE = 1 + 2 * DBZ_STEPS;

const RAIN_CODES = new Set([1, 6, 7, 10, 91, 96]);
const SNOW_CODE = 3;

/** Stored PrecipFlag integer → 0 nothing, 1 rain, 2 snow. */
export function kindTable(flag: GribField, bitDepth: number): Uint8Array {
  const values = decodeAll(flag, bitDepth);
  const out = new Uint8Array(values.length);
  values.forEach((v, x) => {
    const code = Math.round(v);
    out[x] = code === SNOW_CODE ? 2 : RAIN_CODES.has(code) ? 1 : 0;
  });
  return out;
}

/** Stored reflectivity integer → 0 below 5 dBZ (or missing), else its step 1–14. */
export function stepTable(reflectivity: GribField, bitDepth: number): Uint8Array {
  const values = decodeAll(reflectivity, bitDepth);
  const out = new Uint8Array(values.length);
  values.forEach((dbz, x) => {
    out[x] = dbz < 5 ? 0 : 1 + Math.min(DBZ_STEPS - 1, Math.floor((dbz - 5) / 5));
  });
  return out;
}

/**
 * Palette indices for grid rows `y0` up to `y1`, written into `out` (one byte
 * per cell). Done a band of rows at a time so the caller can yield between
 * bands. Cells with no precipitation flag stay transparent even where the
 * radar sees something — that's how MRMS's own QC drops clutter and birds.
 */
export function classifyRows(
  flag: Samples,
  kinds: Uint8Array,
  reflectivity: Samples,
  steps: Uint8Array,
  out: Uint8Array,
  y0: number,
  y1: number,
): void {
  const width = flag.width;
  const f = flag.data, r = reflectivity.data;
  const flag16 = flag.bitDepth === 16, refl16 = reflectivity.bitDepth === 16;
  for (let y = y0; y < y1; y++) {
    const fRow = y * (flag.stride + 1) + 1;
    const rRow = y * (reflectivity.stride + 1) + 1;
    const oRow = y * width;
    for (let x = 0; x < width; x++) {
      const kind = kinds[flag16 ? (f[fRow + 2 * x] << 8) | f[fRow + 2 * x + 1] : f[fRow + x]];
      if (kind === 0) {
        out[oRow + x] = 0;
        continue;
      }
      const step = steps[refl16 ? (r[rRow + 2 * x] << 8) | r[rRow + 2 * x + 1] : r[rRow + x]];
      out[oRow + x] = step === 0 ? 0 : kind === 2 ? SNOW_OFFSET + step : step;
    }
  }
}

// --- Web Mercator tiles -------------------------------------------------------

export const TILE_SIZE = 256;

const worldSize = (z: number) => TILE_SIZE * 2 ** z;
export const lonToPixel = (lon: number, z: number) => ((lon + 180) / 360) * worldSize(z);
export function latToPixel(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * worldSize(z);
}
export function pixelToLat(y: number, z: number): number {
  return (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / worldSize(z)));
}
export const pixelToLon = (x: number, z: number) => (x / worldSize(z)) * 360 - 180;

/** The tiles at zoom `z` that touch the grid, inclusive. */
export function tileRange(grid: LatLonGrid, z: number): { x0: number; x1: number; y0: number; y1: number } {
  const west = grid.lo1 - grid.di / 2, east = grid.lo1 + (grid.ni - 0.5) * grid.di;
  const north = grid.la1 + grid.dj / 2, south = grid.la1 - (grid.nj - 0.5) * grid.dj;
  return {
    x0: Math.floor(lonToPixel(west, z) / TILE_SIZE),
    x1: Math.floor((lonToPixel(east, z) - 1e-9) / TILE_SIZE),
    y0: Math.floor(latToPixel(north, z) / TILE_SIZE),
    y1: Math.floor((latToPixel(south, z) - 1e-9) / TILE_SIZE),
  };
}

/**
 * One tile's palette indices into `out` (256 × 256), nearest grid cell to
 * each pixel's center. A lat/lon grid becomes Mercator by remapping rows only,
 * so a column and a row lookup cover the whole tile. False if it's all clear.
 */
export function renderTile(classes: Uint8Array, grid: LatLonGrid, z: number, tx: number, ty: number, out: Uint8Array): boolean {
  const cols = new Int32Array(TILE_SIZE);
  for (let px = 0; px < TILE_SIZE; px++) {
    const i = Math.round((pixelToLon(tx * TILE_SIZE + px + 0.5, z) - grid.lo1) / grid.di);
    cols[px] = i >= 0 && i < grid.ni ? i : -1;
  }
  let any = 0;
  for (let py = 0; py < TILE_SIZE; py++) {
    const j = Math.round((grid.la1 - pixelToLat(ty * TILE_SIZE + py + 0.5, z)) / grid.dj);
    const row = py * TILE_SIZE;
    if (j < 0 || j >= grid.nj) {
      out.fill(0, row, row + TILE_SIZE);
      continue;
    }
    const src = j * grid.ni;
    for (let px = 0; px < TILE_SIZE; px++) {
      const i = cols[px];
      const v = i < 0 ? 0 : classes[src + i];
      out[row + px] = v;
      any |= v;
    }
  }
  return any !== 0;
}

// --- Indexed PNG output -------------------------------------------------------

/** Rows of palette indices with PNG's per-row filter byte (0, none), ready to deflate. */
export function scanlines(indices: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) out.set(indices.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = view(out);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const hex = (color: string) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));

/** PLTE and tRNS for the palette: index 0 clear, then rain, then snow. */
const PALETTE_CHUNKS = (() => {
  const colors = [[0, 0, 0], ...PRECIP_SCALES.rain.map(([, c]) => hex(c)), ...PRECIP_SCALES.snow.map(([, c]) => hex(c))];
  const alpha = colors.map((_, i) => (i === 0 ? 0 : 255));
  return [chunk("PLTE", Uint8Array.from(colors.flat())), chunk("tRNS", Uint8Array.from(alpha))];
})();

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** A palette PNG from deflated `scanlines`. */
export function indexedPng(width: number, height: number, deflated: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  view(ihdr).setUint32(0, width);
  view(ihdr).setUint32(4, height);
  ihdr[8] = 8; // bits per index
  ihdr[9] = 3; // palette
  const parts = [PNG_SIGNATURE, chunk("IHDR", ihdr), ...PALETTE_CHUNKS, chunk("IDAT", deflated), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
