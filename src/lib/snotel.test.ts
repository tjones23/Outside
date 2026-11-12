import { describe, expect, it } from "vitest";
import {
  buildDepths,
  buildReport,
  dailyWater,
  isStationId,
  latestOf,
  nearestStation,
  newSnow,
  parseData,
  parseStations,
  stationTime,
  verificationDataUrl,
  verificationStations,
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

  it("counts height for more than distance: a mile closer doesn't beat 1,000 ft nearer in height", () => {
    // Both about 2–3 miles from the spot; the closer one is 1,500 ft too low.
    const close = { ...ATWATER, id: "4:UT:SNTL", name: "Close", lat: 40.6, lon: -111.62, elevationFt: 8000 };
    const level = { ...ATWATER, id: "5:UT:SNTL", name: "Level", lat: 40.62, lon: -111.62, elevationFt: 9400 };
    expect(nearestStation([close, level], 40.588, -111.638, 9500)!.station.name).toBe("Level");
  });
});

describe("verificationStations", () => {
  const at = (id: number, miles: number, elevationFt: number): SnotelStation => ({
    ...ATWATER,
    id: `${id}:UT:SNTL`,
    name: String(id),
    lat: 40.588 + miles / 69,
    elevationFt,
  });

  it("takes up to four within 30 miles, ranked with height counting heavily", () => {
    const stations = [at(1, 2, 6000), at(2, 5, 9400), at(3, 12, 9600), at(4, 25, 9500), at(5, 3, 8900), at(6, 40, 9500)];
    const picked = verificationStations(stations, 40.588, -111.638, 9500).map((n) => n.station.name);
    // Scores: 5.5, 6, 12.5, then the valley station 2 miles off (2 + 17.5) over the one 25 miles out at the right height.
    expect(picked).toEqual(["2", "5", "3", "1"]);
    expect(verificationStations(stations, 40.588, -111.638, null)[0].station.name).toBe("1");
  });

  it("asks for gauge and pillow water for every one at once", () => {
    const url = new URL(verificationDataUrl(["1:UT:SNTL", "2:UT:SNTL"], Date.parse("2026-11-12T18:00:00Z"), 30));
    expect(url.searchParams.get("stationTriplets")).toBe("1:UT:SNTL,2:UT:SNTL");
    expect(url.searchParams.get("elements")).toBe("PREC,WTEQ");
    expect(url.searchParams.get("beginDate")).toBe("2026-10-11");
  });
});

describe("dailyWater", () => {
  const series = (prec: [string, number][], swe: [string, number][]) =>
    new Map([
      ["PREC", prec],
      ["WTEQ", swe],
    ]);

  it("takes the larger of the gauge's and the pillow's gain each day", () => {
    const water = dailyWater(
      series(
        [["2026-11-01", 10], ["2026-11-02", 10.8], ["2026-11-03", 10.8], ["2026-11-04", 11]],
        [["2026-11-01", 2], ["2026-11-02", 2.5], ["2026-11-03", 3.1], ["2026-11-04", 3.1]],
      ),
    );
    expect(water.get("2026-11-01")).toBeUndefined();
    expect(water.get("2026-11-02")).toBeCloseTo(0.8);
    // The gauge missed blowing snow the pillow caught.
    expect(water.get("2026-11-03")).toBeCloseTo(0.6);
    expect(water.get("2026-11-04")).toBeCloseTo(0.2);
  });

  it("treats settling and jitter as nothing, and a reset or a gap as unknown", () => {
    const water = dailyWater(
      series(
        [["2026-09-29", 40], ["2026-09-30", 39.9], ["2026-10-01", 0], ["2026-10-03", 0.5]],
        [],
      ),
    );
    expect(water.get("2026-09-30")).toBe(0);
    expect(water.get("2026-10-01")).toBeNull();
    expect(water.has("2026-10-03")).toBe(false);
    expect(dailyWater(undefined).size).toBe(0);
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
