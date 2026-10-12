import { describe, expect, it } from "vitest";
import { fixture } from "./__fixtures__/load";
import { hmsTime, parseSmokeKml, smokeUrl, sortPlumes, utcDate } from "./smoke";

describe("smokeUrl", () => {
  it("points at the day's KML", () => {
    expect(smokeUrl("2026-10-11")).toBe(
      "https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/10/hms_smoke20261011.kml",
    );
  });

  it("counts days in UTC", () => {
    const now = new Date("2026-10-12T01:30:00Z");
    expect(utcDate(now)).toBe("2026-10-12");
    expect(utcDate(now, 1)).toBe("2026-10-11");
  });
});

describe("hmsTime", () => {
  it("reads year, day of year and time", () => {
    expect(hmsTime("2026283 1200UTC")).toBe("2026-10-10T12:00:00.000Z");
    expect(hmsTime("2024060 0030UTC")).toBe("2024-02-29T00:30:00.000Z");
    expect(hmsTime(undefined)).toBeNull();
    expect(hmsTime("soon")).toBeNull();
  });
});

describe("parseSmokeKml", () => {
  const plumes = parseSmokeKml(fixture("hms-smoke.kml"));

  it("reads each plume's density, window and outline", () => {
    expect(plumes.map((p) => p.density)).toEqual(["light", "medium"]);
    expect(plumes[0]).toMatchObject({
      start: "2026-10-10T12:00:00.000Z",
      end: "2026-10-10T15:00:00.000Z",
      satellite: "GOES-WEST",
    });
    expect(plumes[0].rings).toHaveLength(1);
    const [lat, lon] = plumes[0].rings[0][0];
    expect(lat).toBeGreaterThan(15);
    expect(lon).toBeLessThan(-60);
  });

  it("refuses something that isn't KML, and finds nothing in an empty day", () => {
    expect(() => parseSmokeKml("<html>Not Found</html>")).toThrow();
    expect(parseSmokeKml('<?xml version="1.0"?><kml><Document></Document></kml>')).toEqual([]);
  });

  it("falls back to the style name for density", () => {
    const kml = `<kml><Placemark><styleUrl>#Smoke_Heavy_style</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>
      -120,40,0 -119,40,0 -119,41,0 -120,41,0 -120,40,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>`;
    expect(parseSmokeKml(kml).map((p) => p.density)).toEqual(["heavy"]);
  });

  it("draws heavier smoke last", () => {
    const sorted = sortPlumes([...plumes].reverse());
    expect(sorted.map((p) => p.density)).toEqual(["light", "medium"]);
  });
});
