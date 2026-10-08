import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  classifyRows,
  DBZ_STEPS,
  indexedPng,
  kindTable,
  latToPixel,
  mrmsFileUrl,
  PALETTE_SIZE,
  parseGrib2,
  pixelToLat,
  readPng,
  recentFrameTimes,
  renderTile,
  samplesOf,
  scanlines,
  stepTable,
  TILE_SIZE,
  tileRange,
  unfilterRows,
  type LatLonGrid,
} from "./mrms";

// --- Builders: just enough GRIB2 and PNG to look like an MRMS file -----------

/** PNG-filter `rows` (big-endian samples) with `filters[y]` on row y, as an encoder would. */
function filterRows(rows: Uint8Array[], bpp: number, filters: number[]): Uint8Array {
  const stride = rows[0].length;
  const out = new Uint8Array((stride + 1) * rows.length);
  rows.forEach((row, y) => {
    const prev = y > 0 ? rows[y - 1] : new Uint8Array(stride);
    const f = filters[y % filters.length];
    out[y * (stride + 1)] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predictor = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * (stride + 1) + 1 + x] = (row[x] - predictor) & 255;
    }
  });
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length); // CRC left zero: the reader doesn't check it
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(Buffer.from(type, "latin1"), 4);
  out.set(data, 8);
  return out;
}

/** A grayscale PNG of integer samples, rows filtered with each filter type in turn. */
function grayPng(values: number[][], bitDepth: 8 | 16, filters = [0, 1, 2, 3, 4]): Uint8Array {
  const bpp = bitDepth / 8;
  const rows = values.map((r) => {
    const row = new Uint8Array(r.length * bpp);
    r.forEach((v, x) => (bpp === 2 ? new DataView(row.buffer).setUint16(2 * x, v) : (row[x] = v)));
    return row;
  });
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, values[0].length);
  new DataView(ihdr.buffer).setUint32(4, values.length);
  ihdr[8] = bitDepth;
  return Buffer.concat([
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(filterRows(rows, bpp, filters))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function section(num: number, length: number, fill: (dv: DataView, bytes: Uint8Array) => void = () => {}): Uint8Array {
  const bytes = new Uint8Array(length);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, length);
  bytes[4] = num;
  fill(dv, bytes);
  return bytes;
}

const signMagnitude16 = (v: number) => (v < 0 ? 0x8000 | -v : v);

/** A one-field GRIB2 file on a lat/lon grid, values stored as (R + X) / 10^D. */
function grib2(opts: { grid: LatLonGrid; reference: number; decimalScale: number; png: Uint8Array; packing?: number }): Uint8Array {
  const { grid } = opts;
  const micro = (deg: number) => Math.round(deg * 1e6);
  const parts = [
    section(1, 21),
    section(3, 72, (dv, b) => {
      dv.setUint32(30, grid.ni);
      dv.setUint32(34, grid.nj);
      dv.setUint32(46, micro(grid.la1));
      dv.setUint32(50, micro(grid.lo1 < 0 ? grid.lo1 + 360 : grid.lo1));
      dv.setUint32(63, micro(grid.di));
      dv.setUint32(67, micro(grid.dj));
      b[71] = 0;
    }),
    section(4, 34),
    section(5, 21, (dv, b) => {
      dv.setUint16(9, opts.packing ?? 41);
      dv.setFloat32(11, opts.reference);
      dv.setUint16(15, 0);
      dv.setUint16(17, signMagnitude16(opts.decimalScale));
      b[19] = 16;
    }),
    section(6, 6, (_, b) => (b[5] = 255)),
    (() => {
      const s = section(7, 5 + opts.png.length);
      s.set(opts.png, 5);
      return s;
    })(),
  ];
  const body = Buffer.concat(parts);
  const head = new Uint8Array(16);
  head.set(Buffer.from("GRIB", "latin1"));
  head[6] = 209; // MRMS's local discipline
  head[7] = 2;
  new DataView(head.buffer).setBigUint64(8, BigInt(16 + body.length + 4));
  return Buffer.concat([head, body, Buffer.from("7777", "latin1")]);
}

const GRID: LatLonGrid = { ni: 4, nj: 3, la1: 40, lo1: -100, di: 0.01, dj: 0.01 };

/** Decode a field the way the store does, minus the yielding. */
function decode(file: Uint8Array) {
  const field = parseGrib2(file);
  const png = readPng(field.png);
  const samples = unfilterRows(samplesOf(png, inflateSync(png.idat)));
  return { field, png, samples };
}

// --- Tests -------------------------------------------------------------------

describe("mrmsFileUrl / recentFrameTimes", () => {
  it("names NCEP's file for a frame time", () => {
    expect(mrmsFileUrl("PrecipFlag", Date.UTC(2026, 9, 8, 1, 40) / 1000)).toBe(
      "https://mrms.ncep.noaa.gov/2D/PrecipFlag/MRMS_PrecipFlag_00.00_20261008-014000.grib2.gz",
    );
  });

  it("steps back from the last ten-minute mark, newest first", () => {
    const times = recentFrameTimes(Date.UTC(2026, 9, 8, 1, 47, 52), 3);
    expect(times.map((t) => new Date(t * 1000).toISOString().slice(11, 16))).toEqual(["01:40", "01:30", "01:20"]);
  });
});

describe("parseGrib2", () => {
  it("reads the grid, with longitude brought into −180..180", () => {
    const file = grib2({ grid: GRID, reference: 0, decimalScale: 0, png: grayPng([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 8) });
    const field = parseGrib2(file);
    expect(field.grid).toEqual(GRID);
    expect(field.decimalScale).toBe(0);
  });

  it("refuses what it can't decode", () => {
    expect(() => parseGrib2(new Uint8Array(32))).toThrow(/not a GRIB2/);
    const simple = grib2({ grid: GRID, reference: 0, decimalScale: 0, png: new Uint8Array(0), packing: 0 });
    expect(() => parseGrib2(simple)).toThrow(/packing template 5\.0/);
  });
});

describe("unfilterRows", () => {
  it.each([8, 16] as const)("undoes every PNG filter at %i bits", (bitDepth) => {
    const max = 2 ** bitDepth;
    const values = Array.from({ length: 10 }, (_, y) => Array.from({ length: 7 }, (_, x) => (x * 977 + y * 131 + x * y * 61) % max));
    const png = readPng(grayPng(values, bitDepth));
    const samples = samplesOf(png, inflateSync(png.idat));
    // In bands, as the store does it.
    unfilterRows(samples, 0, 4);
    unfilterRows(samples, 4, 10);
    const read = (x: number, y: number) => {
      const at = y * (samples.stride + 1) + 1 + x * (bitDepth / 8);
      return bitDepth === 16 ? (samples.data[at] << 8) | samples.data[at + 1] : samples.data[at];
    };
    expect(values.map((row, y) => row.map((_, x) => read(x, y)))).toEqual(values);
  });
});

describe("classification", () => {
  // PrecipFlag codes stored as code + 3 (R = −3); reflectivity as dBZ·10 + 999 (R = −999, D = 1).
  const codes = [
    [3, 3, 1, 0],
    [6, -3, 10, 7],
    [91, 96, 3, 3],
  ];
  const dbz = [
    [30, 4, 30, 50],
    [72, 30, 5, 65],
    [10, 20, 9.9, -99.9],
  ];
  const flagFile = grib2({ grid: GRID, reference: -3, decimalScale: 0, png: grayPng(codes.map((r) => r.map((c) => c + 3)), 8) });
  const reflFile = grib2({
    grid: GRID,
    reference: -999,
    decimalScale: 1,
    png: grayPng(dbz.map((r) => r.map((d) => Math.round(d * 10) + 999)), 16),
  });

  it("colors by kind and 5 dBZ step, and drops weak or unflagged returns", () => {
    const flag = decode(flagFile);
    const refl = decode(reflFile);
    const out = new Uint8Array(GRID.ni * GRID.nj);
    classifyRows(
      flag.samples,
      kindTable(flag.field, flag.png.bitDepth),
      refl.samples,
      stepTable(refl.field, refl.png.bitDepth),
      out,
      0,
      GRID.nj,
    );
    const snow = (step: number) => DBZ_STEPS + step;
    expect([...out]).toEqual([
      // snow 30 · snow below 5 dBZ · rain 30 · no precipitation
      snow(6), 0, 6, 0,
      // convective 72 (top step) · no coverage · cool stratiform 5 · hail 65
      14, 0, 1, 13,
      // tropical mixes 10 and 20 · snow 9.9 · snow but no echo
      2, 4, snow(1), 0,
    ]);
  });
});

describe("tiles", () => {
  const CONUS: LatLonGrid = { ni: 7000, nj: 3500, la1: 54.995, lo1: -129.995, di: 0.01, dj: 0.01 };

  it("round-trips latitude through Mercator", () => {
    for (const lat of [-60, 0, 20.005, 54.995]) expect(pixelToLat(latToPixel(lat, 7), 7)).toBeCloseTo(lat, 9);
  });

  it("finds the tiles covering MRMS's CONUS grid", () => {
    expect(tileRange(CONUS, 3)).toEqual({ x0: 1, x1: 2, y0: 2, y1: 3 });
  });

  it("samples the nearest cell, and reports clear tiles", () => {
    const grid: LatLonGrid = { ni: 200, nj: 200, la1: 40, lo1: -100, di: 0.1, dj: 0.1 };
    const classes = new Uint8Array(grid.ni * grid.nj).fill(5);
    const out = new Uint8Array(TILE_SIZE * TILE_SIZE);
    // A zoom-6 tile around (30 N, 92 W), well inside the grid.
    const tx = Math.floor((((-92 + 180) / 360) * 2 ** 6 * TILE_SIZE) / TILE_SIZE);
    const ty = Math.floor(latToPixel(30, 6) / TILE_SIZE);
    expect(renderTile(classes, grid, 6, tx, ty, out)).toBe(true);
    expect(out.every((v) => v === 5)).toBe(true);
    // And one over the Atlantic, east of it.
    expect(renderTile(classes, grid, 6, tx + 5, ty, out)).toBe(false);
    expect(out.every((v) => v === 0)).toBe(true);
  });

  it("writes a palette PNG: clear, then rain, then snow", () => {
    const indices = Uint8Array.from([0, 1, 14, 28]);
    const png = indexedPng(2, 2, deflateSync(scanlines(indices, 2, 2)));
    const chunks: Record<string, Uint8Array> = {};
    for (let at = 8; at < png.length; ) {
      const length = new DataView(png.buffer, png.byteOffset).getUint32(at);
      chunks[Buffer.from(png.subarray(at + 4, at + 8)).toString("latin1")] = png.subarray(at + 8, at + 8 + length);
      at += 12 + length;
    }
    expect(chunks.PLTE.length).toBe(PALETTE_SIZE * 3);
    expect([...chunks.tRNS.subarray(0, 2)]).toEqual([0, 255]);
    expect([...inflateSync(chunks.IDAT)]).toEqual([0, 0, 1, 0, 14, 28]);
  });
});
