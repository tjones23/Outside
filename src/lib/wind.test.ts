import { describe, expect, it } from "vitest";
import {
  framesToDraw,
  imageGrid,
  locator,
  parseWindGrib,
  recentRuns,
  unpackSimple,
  windFileUrl,
  windImage,
  windModel,
  windRunCheckUrl,
  WIND_BOUNDS,
  type LambertSource,
  type LatLonSource,
  type WindField,
} from "./wind";

// --- Builders: just enough GRIB2 to look like a filtered NOMADS file ---------

function section(num: number, length: number, fill: (dv: DataView, bytes: Uint8Array) => void = () => {}): Uint8Array {
  const bytes = new Uint8Array(length);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, length);
  bytes[4] = num;
  fill(dv, bytes);
  return bytes;
}

const concat = (parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));
const signMagnitude = (v: number, bits: number) => (v < 0 ? 2 ** (bits - 1) - v : v);
const micro = (deg: number) => Math.round((deg < 0 && Math.abs(deg) > 90 ? deg + 360 : deg) * 1e6);

/** Pack integers big-endian into `bits` bits each. */
function packBits(values: number[], bits: number): Uint8Array {
  const out = new Uint8Array(Math.ceil((values.length * bits) / 8));
  let at = 0;
  for (const x of values) {
    for (let b = bits - 1; b >= 0; b--, at++) if ((x >> b) & 1) out[at >> 3] |= 0x80 >> (at & 7);
  }
  return out;
}

const RUN = Date.UTC(2026, 10, 3, 0) / 1000;

/** One message: `number` 2 is U, 3 is V; values stored as (R + X) / 10^D with D = 1. */
function message(grid: Uint8Array, number: number, ints: number[], opts: { packing?: number; hour?: number } = {}): Uint8Array {
  const bits = 12;
  const body = concat([
    section(1, 21, (dv, b) => {
      dv.setUint16(12, 2026);
      b[14] = 11;
      b[15] = 3;
    }),
    grid,
    section(4, 34, (dv, b) => {
      b[9] = 2;
      b[10] = number;
      b[17] = 1;
      dv.setUint32(18, opts.hour ?? 6);
    }),
    section(5, 21, (dv, b) => {
      dv.setUint32(5, ints.length);
      dv.setUint16(9, opts.packing ?? 0);
      dv.setFloat32(11, -200);
      dv.setUint16(17, signMagnitude(1, 16));
      b[19] = bits;
    }),
    section(6, 6, (_, b) => (b[5] = 255)),
    (() => {
      const data = packBits(ints, bits);
      const s = section(7, 5 + data.length);
      s.set(data, 5);
      return s;
    })(),
  ]);
  const head = new Uint8Array(16);
  head.set([71, 82, 73, 66]); // GRIB
  head[7] = 2;
  new DataView(head.buffer).setBigUint64(8, BigInt(16 + body.length + 4));
  return concat([head, body, Uint8Array.from([55, 55, 55, 55])]);
}

function latLonSection(g: Omit<LatLonSource, "kind">): Uint8Array {
  return section(3, 72, (dv, b) => {
    dv.setUint32(30, g.ni);
    dv.setUint32(34, g.nj);
    dv.setUint32(46, signMagnitude(micro(g.la1), 32));
    dv.setUint32(50, micro(g.lo1 < 0 ? g.lo1 + 360 : g.lo1));
    dv.setUint32(63, micro(g.di));
    dv.setUint32(67, micro(g.dj));
    b[71] = g.northToSouth ? 0 : 0x40;
  });
}

/** Stored integer for a value in m/s: (−200 + X) / 10. */
const stored = (v: number) => Math.round(v * 10 + 200);

// HRRR's own grid, as NOMADS sends it.
const HRRR: LambertSource = {
  kind: "lambert",
  ni: 1799,
  nj: 1059,
  la1: 21.138123,
  lo1: -122.719528,
  lov: -97.5,
  latin1: 38.5,
  latin2: 38.5,
  dx: 3000,
  dy: 3000,
  radius: 6371229,
  northToSouth: false,
  gridRelative: true,
};

function lambertSection(g: LambertSource): Uint8Array {
  return section(3, 81, (dv, b) => {
    dv.setUint16(12, 30);
    b[14] = 6;
    dv.setUint32(30, g.ni);
    dv.setUint32(34, g.nj);
    dv.setUint32(38, micro(g.la1));
    dv.setUint32(42, micro(g.lo1 + 360));
    b[46] = g.gridRelative ? 0x08 : 0;
    dv.setUint32(47, micro(g.latin1));
    dv.setUint32(51, micro(g.lov + 360));
    dv.setUint32(55, g.dx * 1000);
    dv.setUint32(59, g.dy * 1000);
    b[64] = g.northToSouth ? 0 : 0x40;
    dv.setUint32(65, micro(g.latin1));
    dv.setUint32(69, micro(g.latin2));
  });
}

// --- Tests -------------------------------------------------------------------

describe("NOMADS URLs and runs", () => {
  it("asks the GFS filter for 10 m U and V over the drawn area", () => {
    const url = new URL(windFileUrl("gfs", RUN + 6 * 3600, 9));
    expect(url.pathname).toBe("/cgi-bin/filter_gfs_0p25.pl");
    expect(url.searchParams.get("dir")).toBe("/gfs.20261103/06/atmos");
    expect(url.searchParams.get("file")).toBe("gfs.t06z.pgrb2.0p25.f009");
    expect(url.searchParams.get("lev_10_m_above_ground")).toBe("on");
    expect(url.searchParams.get("leftlon")).toBe(String(WIND_BOUNDS.west + 360));
    expect(url.searchParams.get("rightlon")).toBe(String(WIND_BOUNDS.east + 360));
  });

  it("asks the HRRR filter for the whole grid", () => {
    const url = new URL(windFileUrl("hrrr", RUN + 3 * 3600, 7));
    expect(url.pathname).toBe("/cgi-bin/filter_hrrr_2d.pl");
    expect(url.searchParams.get("dir")).toBe("/hrrr.20261103/conus");
    expect(url.searchParams.get("file")).toBe("hrrr.t03z.wrfsfcf07.grib2");
    expect(url.searchParams.has("subregion")).toBe(false);
  });

  it("checks a run by its last hour's inventory", () => {
    expect(windRunCheckUrl("gfs", RUN)).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod/gfs.20261103/00/atmos/gfs.t00z.pgrb2.0p25.f120.idx",
    );
    expect(windRunCheckUrl("hrrr", RUN)).toBe(
      "https://nomads.ncep.noaa.gov/pub/data/nccf/com/hrrr/prod/hrrr.20261103/conus/hrrr.t00z.wrfsfcf18.grib2.idx",
    );
  });

  it("lists recent runs on each model's cadence", () => {
    const now = (RUN + 7.5 * 3600) * 1000;
    expect(recentRuns(windModel("gfs"), now, 2)).toEqual([RUN + 6 * 3600, RUN]);
    expect(recentRuns(windModel("hrrr"), now, 2)).toEqual([RUN + 6 * 3600, RUN + 3 * 3600]);
  });

  it("draws from the frame just past onward", () => {
    const gfs = windModel("gfs");
    const frames = framesToDraw(gfs, RUN, (RUN + 7 * 3600) * 1000);
    expect(frames[0]).toEqual({ hour: 6, time: RUN + 6 * 3600 });
    expect(frames.at(-1)).toEqual({ hour: 120, time: RUN + 120 * 3600 });
  });
});

describe("unpackSimple", () => {
  it("unpacks odd bit widths across byte boundaries", () => {
    const ints = [0, 1, 1023, 512, 7, 900, 3];
    expect([...unpackSimple(packBits(ints, 10), ints.length, 10, 0, 0, 0)]).toEqual(ints);
  });

  it("applies reference, binary and decimal scales", () => {
    const out = unpackSimple(packBits([0, 16, 32], 6), 3, 6, -50, -4, 1);
    // (R + X · 2^−4) / 10
    expect([...out].map((v) => +v.toFixed(4))).toEqual([-5, -4.9, -4.8]);
  });

  it("fills a constant field when there are no bits", () => {
    expect([...unpackSimple(new Uint8Array(0), 3, 0, 25, 0, 1)]).toEqual([2.5, 2.5, 2.5]);
  });

  it("refuses data shorter than its points", () => {
    expect(() => unpackSimple(new Uint8Array(1), 4, 8, 0, 0, 0)).toThrow(/shorter/);
  });
});

describe("parseWindGrib", () => {
  const grid = { ni: 3, nj: 2, la1: 20, lo1: -130, di: 0.25, dj: 0.25, northToSouth: false };
  const us = [1, 2, 3, 4, 5, 6], vs = [-1, -2, -3, -4, -5, -6];
  const file = concat([
    message(latLonSection(grid), 2, us.map(stored)),
    message(latLonSection(grid), 3, vs.map(stored)),
  ]);

  it("reads U and V, the grid and the run", () => {
    const field = parseWindGrib(file);
    expect(field.grid).toEqual({ kind: "latlon", ...grid });
    expect(field.run).toBe(RUN);
    expect(field.hour).toBe(6);
    expect([...field.u].map((v) => +v.toFixed(3))).toEqual(us);
    expect([...field.v].map((v) => +v.toFixed(3))).toEqual(vs);
  });

  it("reads a Lambert grid", () => {
    const small = { ...HRRR, ni: 2, nj: 1 };
    const field = parseWindGrib(concat([message(lambertSection(small), 2, [200, 210]), message(lambertSection(small), 3, [200, 190])]));
    expect(field.grid).toEqual(small);
    expect([...field.u]).toEqual([0, 1]);
  });

  it("refuses what it can't decode", () => {
    expect(() => parseWindGrib(new Uint8Array(32))).toThrow(/not a GRIB2/);
    expect(() => parseWindGrib(message(latLonSection(grid), 2, us.map(stored)))).toThrow(/missing U or V/);
    expect(() => parseWindGrib(message(latLonSection(grid), 2, us.map(stored), { packing: 3 }))).toThrow(/5\.3/);
    const other = { ...grid, di: 0.5 };
    expect(() =>
      parseWindGrib(concat([message(latLonSection(grid), 2, us.map(stored)), message(latLonSection(other), 3, vs.map(stored))])),
    ).toThrow(/different grids/);
  });
});

describe("locator", () => {
  it("puts lat/lon points on either scan direction", () => {
    const south = locator({ kind: "latlon", ni: 10, nj: 10, la1: 20, lo1: -130, di: 0.5, dj: 0.5, northToSouth: false });
    expect(south(21, -129)).toEqual({ i: 2, j: 2, angle: 0 });
    const north = locator({ kind: "latlon", ni: 10, nj: 10, la1: 55, lo1: 230, di: 0.5, dj: 0.5, northToSouth: true });
    expect(north(54, -129)).toEqual({ i: 2, j: 2, angle: 0 });
  });

  it("lands HRRR's published corners on the grid's corners", () => {
    const at = locator(HRRR);
    const first = at(HRRR.la1, HRRR.lo1);
    expect(first.i).toBeCloseTo(0, 6);
    expect(first.j).toBeCloseTo(0, 6);
    // The north-east corner, from NCEP's HRRR grid description.
    const last = at(47.842195, -60.917193);
    expect(last.i).toBeCloseTo(HRRR.ni - 1, 3);
    expect(last.j).toBeCloseTo(HRRR.nj - 1, 3);
  });

  it("rotates grid-relative winds away from the central meridian", () => {
    const at = locator(HRRR);
    expect(at(40, HRRR.lov).angle).toBeCloseTo(0, 9);
    const n = Math.sin(HRRR.latin1 * (Math.PI / 180));
    expect(at(40, -77.5).angle).toBeCloseTo(n * 20 * (Math.PI / 180), 9);
    expect(at(40, -117.5).angle).toBeCloseTo(-n * 20 * (Math.PI / 180), 9);
  });
});

describe("windImage", () => {
  const out = { west: -100, north: 41, step: 0.5, width: 5, height: 3 };

  function field(grid: LatLonSource | LambertSource, u: number, v: number): WindField {
    const count = grid.ni * grid.nj;
    return { grid, run: RUN, hour: 0, u: new Float32Array(count).fill(u), v: new Float32Array(count).fill(v) };
  }

  const pixel = (rows: Uint8Array, x: number, y: number) => {
    const at = y * (1 + 3 * out.width) + 1 + 3 * x;
    return [rows[at], rows[at + 1], rows[at + 2]];
  };

  it("blends between grid points and scales into bytes", () => {
    const grid: LatLonSource = { kind: "latlon", ni: 2, nj: 2, la1: 41, lo1: -100, di: 2, dj: 1, northToSouth: true };
    const f = field(grid, 0, 5);
    f.u.set([0, 10, 0, 10]); // U grows eastward from 0 to 10 over 2°
    const image = windImage(f, out);
    expect(image.scale).toEqual({ uMin: 0, uMax: 10, vMin: 5, vMax: 5 });
    expect(pixel(image.scanlines, 0, 0)).toEqual([0, 0, 255]);
    expect(pixel(image.scanlines, 2, 1)).toEqual([128, 0, 255]); // halfway: 5 m/s
    expect(pixel(image.scanlines, 4, 2)).toEqual([255, 0, 255]);
  });

  it("leaves points outside the model's grid empty", () => {
    const grid: LatLonSource = { kind: "latlon", ni: 2, nj: 2, la1: 41, lo1: -100, di: 1, dj: 1, northToSouth: true };
    const image = windImage(field(grid, 3, 4), out);
    expect(pixel(image.scanlines, 2, 0)[2]).toBe(255);
    expect(pixel(image.scanlines, 3, 0)).toEqual([0, 0, 0]);
  });

  it("turns grid-relative winds to true east and north", () => {
    // A wind straight along HRRR's +y axis, east of the central meridian, blows a little west of north.
    const image = windImage(field(HRRR, 0, 10), { west: -77.5, north: 40, step: 1, width: 1, height: 1 });
    const angle = Math.sin(HRRR.latin1 * (Math.PI / 180)) * 20 * (Math.PI / 180);
    expect(image.scale.uMin).toBeCloseTo(10 * Math.sin(angle), 1);
    expect(image.scale.vMin).toBeCloseTo(10 * Math.cos(angle), 1);
  });

  it("covers the drawn area at each model's spacing", () => {
    expect(imageGrid(windModel("gfs"))).toEqual({ west: -135, north: 55, step: 0.25, width: 301, height: 141 });
    expect(imageGrid(windModel("hrrr"))).toEqual({ west: -135, north: 55, step: 0.1, width: 751, height: 351 });
  });
});
