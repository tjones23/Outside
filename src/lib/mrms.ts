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

// --- Cells -------------------------------------------------------------------

/**
 * Each grid cell packed into a byte: 0 for no precipitation, otherwise
 * dBZ + 10 (1–127) in the low bits and 128 added for snow. Keeping dBZ to the
 * decibel, rather than its color step, is what lets tiles interpolate between
 * cells (see `renderTile`), and keeping light returns down to −9 dBZ lets the
 * 5 dBZ edge fall in the right place between a weak cell and an empty one.
 */
const SNOW_BIT = 128;
const DBZ_OFFSET = 10;

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

/** Stored reflectivity integer → dBZ + 10, 1–127; 0 for anything weaker than −9 dBZ, or missing. */
export function dbzTable(reflectivity: GribField, bitDepth: number): Uint8Array {
  const values = decodeAll(reflectivity, bitDepth);
  const out = new Uint8Array(values.length);
  values.forEach((dbz, x) => {
    const q = Math.round(dbz + DBZ_OFFSET);
    out[x] = q < 1 ? 0 : Math.min(127, q);
  });
  return out;
}

/** Cells per side of the blocks `CellGrid.blocks` marks, for skipping empty tiles. */
const BLOCK = 16;

/** The packed cells of one frame, with a coarse map of where anything is falling. */
export interface CellGrid {
  grid: LatLonGrid;
  cells: Uint8Array;
  /** One byte per BLOCK × BLOCK cells, nonzero if any of them has precipitation. */
  blocks: Uint8Array;
  blocksWide: number;
}

export function emptyCellGrid(grid: LatLonGrid): CellGrid {
  const blocksWide = Math.ceil(grid.ni / BLOCK);
  return {
    grid,
    cells: new Uint8Array(grid.ni * grid.nj),
    blocks: new Uint8Array(blocksWide * Math.ceil(grid.nj / BLOCK)),
    blocksWide,
  };
}

/**
 * Pack grid rows `y0` up to `y1` into `target`. Done a band of rows at a time
 * so the caller can yield between bands. Cells with no precipitation flag stay
 * empty even where the radar sees something — that's how MRMS's own QC drops
 * clutter and birds.
 */
export function packRows(
  flag: Samples,
  kinds: Uint8Array,
  reflectivity: Samples,
  dbzs: Uint8Array,
  target: CellGrid,
  y0: number,
  y1: number,
): void {
  const width = flag.width;
  const f = flag.data, r = reflectivity.data;
  const { cells, blocks, blocksWide } = target;
  const flag16 = flag.bitDepth === 16, refl16 = reflectivity.bitDepth === 16;
  for (let y = y0; y < y1; y++) {
    const fRow = y * (flag.stride + 1) + 1;
    const rRow = y * (reflectivity.stride + 1) + 1;
    const oRow = y * width;
    const bRow = Math.floor(y / BLOCK) * blocksWide;
    for (let x = 0; x < width; x++) {
      const kind = kinds[flag16 ? (f[fRow + 2 * x] << 8) | f[fRow + 2 * x + 1] : f[fRow + x]];
      const q = kind === 0 ? 0 : dbzs[refl16 ? (r[rRow + 2 * x] << 8) | r[rRow + 2 * x + 1] : r[rRow + x]];
      if (q === 0) {
        cells[oRow + x] = 0;
        continue;
      }
      cells[oRow + x] = kind === 2 ? SNOW_BIT | q : q;
      blocks[bRow + Math.floor(x / BLOCK)] = 1;
    }
  }
}

// --- Palette -------------------------------------------------------------------

/** Steps per kind in the palette: 5 dBZ wide, 5 to 70+. */
export const DBZ_STEPS = 14;
/** Palette index 0 is transparent; 1–14 rain by intensity; 15–28 snow. */
export const PALETTE_SIZE = 1 + 2 * DBZ_STEPS;

/** Blended values land a hair off whole decibels (four 30s can sum to 29.999…). */
const EPSILON = 1e-6;

/** The palette index for a reflectivity and kind; 0 below 5 dBZ. */
export function paletteIndex(dbz: number, snow: boolean): number {
  if (!(dbz >= 5 - EPSILON)) return 0;
  const step = 1 + Math.min(DBZ_STEPS - 1, Math.max(0, Math.floor((dbz - 5) / 5 + EPSILON)));
  return snow ? DBZ_STEPS + step : step;
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

/** What an empty neighbor counts as when blending: well below anything drawn. */
const NO_ECHO_DBZ = -20;

/** A cell's dBZ for blending. */
const cellDbz = (v: number) => (v === 0 ? NO_ECHO_DBZ : (v & 127) - DBZ_OFFSET);

/**
 * The palette index between four packed cells — `a` and `b` along the top,
 * `c` and `d` below — at fraction `wx` across and `wy` down: reflectivity
 * blended bilinearly, and rain or snow by whichever has more weight.
 */
export function blendCells(a: number, b: number, c: number, d: number, wx: number, wy: number): number {
  const wa = (1 - wx) * (1 - wy), wb = wx * (1 - wy), wc = (1 - wx) * wy, wd = wx * wy;
  const dbz = wa * cellDbz(a) + wb * cellDbz(b) + wc * cellDbz(c) + wd * cellDbz(d);
  if (!(dbz >= 5)) return 0;
  let snow = 0;
  if (a) snow += a & SNOW_BIT ? wa : -wa;
  if (b) snow += b & SNOW_BIT ? wb : -wb;
  if (c) snow += c & SNOW_BIT ? wc : -wc;
  if (d) snow += d & SNOW_BIT ? wd : -wd;
  return paletteIndex(dbz, snow > 0);
}

/** True if any block under the tile has precipitation (with a cell of margin for blending). */
function tileHasEcho(frame: CellGrid, z: number, tx: number, ty: number): boolean {
  const { grid, blocks, blocksWide } = frame;
  const i0 = Math.floor((pixelToLon(tx * TILE_SIZE, z) - grid.lo1) / grid.di) - 1;
  const i1 = Math.ceil((pixelToLon((tx + 1) * TILE_SIZE, z) - grid.lo1) / grid.di) + 1;
  const j0 = Math.floor((grid.la1 - pixelToLat(ty * TILE_SIZE, z)) / grid.dj) - 1;
  const j1 = Math.ceil((grid.la1 - pixelToLat((ty + 1) * TILE_SIZE, z)) / grid.dj) + 1;
  const bi0 = Math.max(0, Math.floor(i0 / BLOCK)), bi1 = Math.min(blocksWide - 1, Math.floor(i1 / BLOCK));
  const bj0 = Math.max(0, Math.floor(j0 / BLOCK)), bj1 = Math.min(blocks.length / blocksWide - 1, Math.floor(j1 / BLOCK));
  for (let bj = bj0; bj <= bj1; bj++) {
    for (let bi = bi0; bi <= bi1; bi++) if (blocks[bj * blocksWide + bi]) return true;
  }
  return false;
}

/**
 * One tile's palette indices into `out` (256 × 256). False, with `out` left
 * as it was, if nothing is falling under it.
 *
 * Each pixel blends the four grid cells around it (bilinear), so storm edges
 * and intensity bands come out as smooth contours instead of the ~1 km grid's
 * squares — which matters once the map is zoomed past the grid's own
 * resolution. Rain or snow is decided the same way: whichever kind has more
 * weight among the four. A lat/lon grid becomes Mercator by remapping rows
 * only, so a column and a row lookup cover the whole tile.
 */
export function renderTile(frame: CellGrid, z: number, tx: number, ty: number, out: Uint8Array): boolean {
  if (!tileHasEcho(frame, z, tx, ty)) return false;
  const { grid, cells } = frame;
  const { ni, nj } = grid;

  // Grid coordinates are measured from cell centers.
  const colA = new Int32Array(TILE_SIZE), colB = new Int32Array(TILE_SIZE), colW = new Float64Array(TILE_SIZE);
  for (let px = 0; px < TILE_SIZE; px++) {
    const fi = (pixelToLon(tx * TILE_SIZE + px + 0.5, z) - grid.lo1) / grid.di;
    const i = Math.floor(fi);
    colA[px] = i >= 0 && i < ni ? i : -1;
    colB[px] = i + 1 >= 0 && i + 1 < ni ? i + 1 : -1;
    colW[px] = fi - i;
  }

  let any = 0;
  for (let py = 0; py < TILE_SIZE; py++) {
    const fj = (grid.la1 - pixelToLat(ty * TILE_SIZE + py + 0.5, z)) / grid.dj;
    const j = Math.floor(fj);
    const wy = fj - j;
    const rowA = j >= 0 && j < nj ? j * ni : -1;
    const rowB = j + 1 >= 0 && j + 1 < nj ? (j + 1) * ni : -1;
    const o = py * TILE_SIZE;
    for (let px = 0; px < TILE_SIZE; px++) {
      const ca = colA[px], cb = colB[px];
      const a = rowA >= 0 && ca >= 0 ? cells[rowA + ca] : 0;
      const b = rowA >= 0 && cb >= 0 ? cells[rowA + cb] : 0;
      const c = rowB >= 0 && ca >= 0 ? cells[rowB + ca] : 0;
      const d = rowB >= 0 && cb >= 0 ? cells[rowB + cb] : 0;
      if ((a | b | c | d) === 0) {
        out[o + px] = 0;
        continue;
      }
      const v = blendCells(a, b, c, d, colW[px], wy);
      out[o + px] = v;
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
