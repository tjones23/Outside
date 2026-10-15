import { describe, expect, it } from "vitest";
import {
  buildDepths,
  buildReport,
  isStationId,
  latestOf,
  nearestStation,
  newSnow,
  parseData,
  parseStations,
  stationTime,
  type SnotelStation,
} from "./snotel";

const ATWATER: SnotelStation = { id: "1308:UT:SNTL", name: "Atwater", lat: 40.591, lon: -111.638, elevationFt: 8750, utcOffset: -8 };

/** An AWDB data answer for one station. */
function data(id: string, elements: Record<string, [string, number | null][]>) {
  return [
    {
      stationTriplet: id,
      data: Object.entries(elements).map(([code, values]) => ({
        stationElement: { elementCode: code },
        values: values.map(([date, value]) => ({ date, value })),
      })),
    },
  ];
}

describe("parsing", () => {
  it("reads stations, skipping ones without a SNOTEL triplet or a position", () => {
    const stations = parseStations([
      { stationTriplet: "1308:UT:SNTL", name: "Atwater", latitude: 40.59124, longitude: -111.63775, elevation: 8750, dataTimeZone: -8 },
      { stationTriplet: "1308:UT:SCAN", latitude: 1, longitude: 1 },
      { stationTriplet: "999:UT:SNTL", name: "No place" },
    ]);
    expect(stations).toEqual([
      { id: "1308:UT:SNTL", name: "Atwater", lat: 40.59124, lon: -111.63775, elevationFt: 8750, utcOffset: -8 },
    ]);
    expect(isStationId("1308:UT:SNTL")).toBe(true);
    expect(isStationId("1308:UT:SNTL&x=1")).toBe(false);
  });

  it("reads readings by element, dropping nulls", () => {
    const parsed = parseData(data("1308:UT:SNTL", { SNWD: [["2026-10-13", 6], ["2026-10-14", null]] }));
    expect(parsed.get("1308:UT:SNTL")!.get("SNWD")).toEqual([["2026-10-13", 6]]);
  });

  it("puts a station's local readings on the right UTC hour", () => {
    expect(new Date(stationTime("2026-10-14 15:00", -8)).toISOString()).toBe("2026-10-14T23:00:00.000Z");
    expect(new Date(stationTime("2026-10-14", -8)).toISOString()).toBe("2026-10-14T08:00:00.000Z");
  });
});

describe("latestOf", () => {
  it("takes the median of the last three readings, never below zero", () => {
    expect(latestOf([["a", 5], ["b", 9], ["c", 6], ["2026-10-14 15:00", 30]], -8)!.value).toBe(9);
    expect(latestOf([["2026-10-14 15:00", -2]], -8)!.value).toBe(0);
    expect(latestOf([], -8)).toBeNull();
  });

  it("gives every reporting station its depth", () => {
    const parsed = parseData(data(ATWATER.id, { SNWD: [["2026-10-14 13:00", 7], ["2026-10-14 14:00", 6], ["2026-10-14 15:00", 6]] }));
    const [d] = buildDepths([ATWATER, { ...ATWATER, id: "1:UT:SNTL" }], parsed);
    expect(d).toMatchObject({ id: ATWATER.id, depthIn: 6, at: Date.parse("2026-10-14T23:00:00Z") });
  });
});

describe("nearestStation", () => {
  const valley = { ...ATWATER, id: "2:UT:SNTL", name: "Valley", lat: 40.62, lon: -111.7, elevationFt: 5000 };
  const ridge = { ...ATWATER, id: "3:UT:SNTL", name: "Ridge", lat: 40.55, lon: -111.6, elevationFt: 9500 };

  it("is the closest one within range", () => {
    expect(nearestStation([valley, ATWATER, ridge], 40.588, -111.638, null)!.station.name).toBe("Atwater");
    expect(nearestStation([ATWATER], 39, -111.6, null)).toBeNull();
  });

  it("trades distance for height when the spot's height is known", () => {
    // From the valley floor, the valley station is nearest…
    expect(nearestStation([valley, ridge], 40.61, -111.69, null)!.station.name).toBe("Valley");
    // …but for a 9,500 ft mid-mountain the ridge station wins.
    expect(nearestStation([valley, ridge], 40.61, -111.69, 9500)!.station.name).toBe("Ridge");
  });
});

describe("newSnow", () => {
  it("counts a rise when the pillow gained water, or when it's too big to be noise", () => {
    expect(newSnow(1, 6, 0.5, 0.7)).toBe(5);
    expect(newSnow(10, 11, 3, 3)).toBe(0);
    expect(newSnow(10, 14, 3, 3)).toBe(4);
    expect(newSnow(10, 8, 3, 3.1)).toBe(0);
    expect(newSnow(null, 8, 3, 3.1)).toBeNull();
  });
});

describe("buildReport", () => {
  // Daily values close each day: Oct 12's is midnight going into Oct 13.
  const dates = Array.from({ length: 17 }, (_, i) => new Date(Date.UTC(2026, 8, 27 + i)).toISOString().slice(0, 10));
  const depth = (d: string) => (d >= "2026-10-13" ? 6 : d >= "2026-10-12" ? 1 : d === "2026-10-05" ? 10 : d >= "2026-10-02" && d < "2026-10-05" ? 3 : 0);
  const swe = (d: string) => (d >= "2026-10-13" ? 0.7 : d >= "2026-10-12" ? 0.5 : d === "2026-10-05" ? 1 : d >= "2026-10-02" && d < "2026-10-05" ? 0.3 : 0);
  const daily = parseData(
    data(ATWATER.id, { SNWD: dates.map((d) => [d, depth(d)]), WTEQ: dates.map((d) => [d, swe(d)]) }),
  ).get(ATWATER.id);
  const hourly = parseData(
    data(ATWATER.id, {
      SNWD: [["2026-10-14 13:00", 9], ["2026-10-14 14:00", 9], ["2026-10-14 15:00", 9]],
      WTEQ: [["2026-10-14 13:00", 0.9], ["2026-10-14 14:00", 0.9], ["2026-10-14 15:00", 0.9]],
    }),
  ).get(ATWATER.id);
  const report = buildReport(ATWATER, 0.21, daily, hourly);

  it("reports today's depth from the hourly readings", () => {
    expect(report).toMatchObject({ depthIn: 9, sweIn: 0.9, miles: 0.2 });
  });

  it("lists 15 whole days and today, with what fell each day", () => {
    expect(report.days).toHaveLength(16);
    expect(report.days.at(-1)).toMatchObject({ date: "2026-10-14", newIn: 3, partial: true });
    expect(report.days.find((d) => d.date === "2026-10-13")!.newIn).toBe(5);
  });

  it("totals the three stretches, the latest including today", () => {
    const [last5, mid, old] = report.periods;
    // Oct 12 (+1) and Oct 13 (+5), and today's +3.
    expect(last5).toMatchObject({ newIn: 9, sweGainIn: 0.9 });
    // Oct 5: +7 with water.
    expect(mid.newIn).toBe(7);
    // Oct 2: +3 (counted on size alone… and it had water).
    expect(old.newIn).toBe(3);
  });

  it("has no total for a stretch it can't fully see", () => {
    const short = buildReport(ATWATER, 1, parseData(data(ATWATER.id, { SNWD: [["2026-10-13", 6]] })).get(ATWATER.id), undefined);
    expect(short.periods[0].newIn).toBeNull();
    expect(short.depthIn).toBe(6);
  });
});
