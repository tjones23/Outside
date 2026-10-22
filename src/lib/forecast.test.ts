import { describe, expect, it } from "vitest";
import {
  buildHrrrFrames,
  buildNdfdFrames,
  forecastProduct,
  hrrrTileUrl,
  isForecastProduct,
  NDFD_LAYERS,
  ndfdGetMapUrl,
  ndfdValidTime,
  parseHrrrMeta,
  parseNdfdTimes,
  pickNdfdTimes,
  tileBounds,
} from "./forecast";

describe("HRRR", () => {
  const meta = (minute: number, run: string, valid: string) =>
    parseHrrrMeta(minute, { model_init_utc: run, forecast_minute: minute, model_forecast_utc: valid });

  it("reads IEM's per-minute metadata", () => {
    expect(meta(60, "2026-10-07T14:00:00Z", "2026-10-07T15:00:00Z")).toEqual({
      minute: 60,
      run: "2026-10-07T14:00:00Z",
      valid: "2026-10-07T15:00:00Z",
    });
    expect(parseHrrrMeta(0, { nope: true })).toBeNull();
  });

  it("stamps each tile URL with its run, so a new run never shows cached tiles", () => {
    expect(hrrrTileUrl(60, "2026-10-07T14:00:00Z")).toBe(
      "https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0060-202610071400/{z}/{x}/{y}.png",
    );
  });

  it("orders frames by valid time, and prefers the newer run when two overlap", () => {
    const frames = buildHrrrFrames([
      meta(0, "2026-10-07T15:00:00Z", "2026-10-07T15:00:00Z"),
      meta(60, "2026-10-07T14:00:00Z", "2026-10-07T15:00:00Z"),
      meta(120, "2026-10-07T14:00:00Z", "2026-10-07T16:00:00Z"),
      null,
    ]);
    expect(frames.frames).toHaveLength(2);
    expect(frames.frames[0].url).toContain("REFD-F0000-202610071500");
    expect(frames.frames[1].time - frames.frames[0].time).toBe(3600);
    expect(frames.runTime).toBe(Date.parse("2026-10-07T15:00:00Z") / 1000);
  });
});

describe("NDFD", () => {
  const xml = `
    <Layer><Name>ndfd.conus.t</Name><Title>t</Title>
      <Dimension name="vtit" default="1970-01-01T00:00">2026-10-07T12:00,2026-10-07T13:00,2026-10-07T14:00,2026-10-07T15:00,2026-10-07T18:00,2026-10-07T21:00,2026-10-08T00:00,bogus</Dimension>
    </Layer>
    <Layer><Name>ndfd.conus.qpf</Name><Title>q</Title>
      <Dimension name="vtit" default="1970-01-01T00:00">2026-10-07T18:00</Dimension>
    </Layer>`;

  it("reads a layer's valid times from the capabilities document", () => {
    expect(parseNdfdTimes(xml, "ndfd.conus.t")).toHaveLength(7);
    expect(parseNdfdTimes(xml, "ndfd.conus.qpf")).toEqual(["2026-10-07T18:00"]);
    expect(parseNdfdTimes(xml, "ndfd.conus.sky")).toEqual([]);
  });

  it("starts at the last time at or before now and thins to every 3 hours", () => {
    const now = Date.parse("2026-10-07T14:30:00Z");
    expect(pickNdfdTimes(parseNdfdTimes(xml, "ndfd.conus.t"), now)).toEqual([
      "2026-10-07T14:00",
      "2026-10-07T18:00",
      "2026-10-07T21:00",
      "2026-10-08T00:00",
    ]);
  });

  it("thins to 6 hours past day three, and caps the count", () => {
    const times = Array.from({ length: 7 * 24 }, (_, h) => new Date(Date.UTC(2026, 9, 7, h)).toISOString().slice(0, 16));
    const picked = pickNdfdTimes(times, Date.UTC(2026, 9, 7, 0), 100);
    const gaps = picked.slice(1).map((t, i) => (Date.parse(`${t}:00Z`) - Date.parse(`${picked[i]}:00Z`)) / 3_600_000);
    expect(gaps.slice(0, 20).every((g) => g === 3)).toBe(true);
    expect(gaps.at(-1)).toBe(6);
    expect(pickNdfdTimes(times, Date.UTC(2026, 9, 7, 0), 10)).toHaveLength(10);
  });

  it("builds NDFD frames as this server's tiles, with the valid time in the path", () => {
    const frames = buildNdfdFrames(forecastProduct("ndfd-temp"), ["2026-10-07T18:00"]);
    expect(frames.frames[0]).toEqual({
      time: Date.parse("2026-10-07T18:00:00Z") / 1000,
      url: "/api/ndfd/ndfd.conus.t/2026-10-07T1800/{z}/{x}/{y}.png",
    });
    expect(ndfdValidTime("2026-10-07T1800")).toBe("2026-10-07T18:00");
    expect(ndfdValidTime("2026-10-07T18:00")).toBeNull();
    expect(NDFD_LAYERS.has("ndfd.conus.t")).toBe(true);
  });

  it("asks NWS for a tile as a Web Mercator GetMap", () => {
    expect(tileBounds(0, 0, 0).map(Math.round)).toEqual([-20037508, -20037508, 20037508, 20037508]);
    expect(tileBounds(1, 1, 0).map(Math.round)).toEqual([0, 0, 20037508, 20037508]);
    const url = new URL(ndfdGetMapUrl("ndfd.conus.t", "2026-10-07T18:00", 1, 1, 0));
    expect(url.origin + url.pathname).toBe("https://digital.weather.gov/ndfd/wms");
    expect(url.searchParams.get("LAYERS")).toBe("ndfd.conus.t");
    expect(url.searchParams.get("VTIT")).toBe("2026-10-07T18:00");
    expect(url.searchParams.get("SRS")).toBe("EPSG:3857");
    expect(url.searchParams.get("TRANSPARENT")).toBe("true");
  });

  it("knows its product ids", () => {
    expect(isForecastProduct("hrrr-refd")).toBe(true);
    expect(isForecastProduct("gfs")).toBe(false);
  });
});
