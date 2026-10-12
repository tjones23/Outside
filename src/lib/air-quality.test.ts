import { describe, expect, it } from "vitest";
import { fixture } from "./__fixtures__/load";
import { airNowHour, airNowUrl, aqiCategory, hourIso, parseAirNow, parseCsv, pollutantReadings } from "./air-quality";

describe("AirNow file names", () => {
  it("names each UTC hour's file", () => {
    const now = new Date("2026-10-12T02:13:00Z");
    expect(airNowHour(now, 1)).toBe("2026101201");
    expect(airNowHour(now, 3)).toBe("2026101123");
    expect(airNowUrl("2026101200")).toBe(
      "https://files.airnowtech.org/airnow/2026/20261012/HourlyAQObs_2026101200.dat",
    );
    expect(hourIso("2026101123")).toBe("2026-10-11T23:00:00.000Z");
  });
});

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas inside fields and CRLF", () => {
    expect(parseCsv('"a","b, c"\r\n"say ""hi""",""\r\n')).toEqual([
      ["a", "b, c"],
      ['say "hi"', ""],
    ]);
    expect(parseCsv("x,y\n1,2")).toEqual([
      ["x", "y"],
      ["1", "2"],
    ]);
  });
});

describe("parseAirNow", () => {
  const sites = parseAirNow(fixture("airnow-hourly.dat"), "2026101200");

  it("keeps North American monitors that reported an AQI", () => {
    // The inactive Fresno site has no readings; the Japanese one is out of bounds.
    expect(sites.map((s) => s.name)).toEqual(["Fresno - Garland", "CHARLOTTETOWN"]);
  });

  it("takes a monitor's AQI from its worst pollutant", () => {
    const fresno = sites[0];
    expect(fresno).toMatchObject({
      id: "060190011",
      coord: [36.78538, -119.77321],
      aqi: 55,
      pollutant: "pm25",
      byPollutant: { pm25: 55, ozone: 37, pm10: 53, no2: 2 },
      pm25: 10.2,
      agency: "California Air Resources Board",
      observed: "2026-10-12T00:00:00.000Z",
    });
    expect(pollutantReadings(fresno).map((r) => r.pollutant)).toEqual(["pm25", "pm10", "ozone", "no2"]);
  });

  it("refuses a file that isn't AirNow's", () => {
    expect(() => parseAirNow("<Error>NoSuchKey</Error>", "2026101200")).toThrow();
  });
});

describe("aqiCategory", () => {
  it("uses EPA's breakpoints", () => {
    expect([0, 50, 51, 100, 101, 150, 151, 200, 201, 300, 301, 500].map((a) => aqiCategory(a).label)).toEqual([
      "Good",
      "Good",
      "Moderate",
      "Moderate",
      "Unhealthy for sensitive groups",
      "Unhealthy for sensitive groups",
      "Unhealthy",
      "Unhealthy",
      "Very unhealthy",
      "Very unhealthy",
      "Hazardous",
      "Hazardous",
    ]);
  });
});
