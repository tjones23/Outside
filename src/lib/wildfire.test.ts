import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import {
  containmentBand,
  containmentText,
  fireMarkerSize,
  fireName,
  formatAcres,
  hotspotColor,
  hotspotsUrl,
  HOTSPOT_AGES,
  incidentsUrl,
  irwinId,
  parseHotspots,
  parseIncidents,
  parsePage,
  parsePerimeters,
  perimetersUrl,
} from "./wildfire";

describe("query URLs", () => {
  it("asks for wildfires only, a page at a time, as GeoJSON in lat/lon", () => {
    const url = new URL(incidentsUrl(2000));
    expect(url.searchParams.get("where")).toBe("IncidentTypeCategory='WF'");
    expect(url.searchParams.get("resultOffset")).toBe("2000");
    expect(url.searchParams.get("f")).toBe("geojson");
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("outFields")).toContain("PercentContained");
  });

  it("has the service simplify perimeters", () => {
    const url = new URL(perimetersUrl());
    expect(url.searchParams.get("where")).toBe("attr_IncidentTypeCategory='WF'");
    expect(Number(url.searchParams.get("maxAllowableOffset"))).toBeGreaterThan(0);
  });

  it("limits hotspots to the last day over North America", () => {
    const url = new URL(hotspotsUrl());
    expect(url.searchParams.get("where")).toBe("hours_old<=24");
    expect(url.searchParams.get("geometryType")).toBe("esriGeometryEnvelope");
  });
});

describe("parsePage", () => {
  it("reads features and whether more are waiting", () => {
    const page = parsePage(jsonFixture("wfigs-incidents.geojson"));
    expect(page.features).toHaveLength(4);
    expect(page.more).toBe(true);
    expect(parsePage({ type: "FeatureCollection", features: [] }).more).toBe(false);
  });

  it("throws on ArcGIS's 200-with-an-error answers rather than reading them as no fires", () => {
    expect(() => parsePage({ error: { code: 400, message: "Invalid query" } })).toThrow(/ArcGIS error/);
    expect(() => parsePage(null)).toThrow();
  });
});

describe("parseIncidents", () => {
  const fires = parseIncidents(parsePage(jsonFixture("wfigs-incidents.geojson")).features);

  it("reads each fire, skipping one without a location", () => {
    expect(fires.map((f) => f.name)).toEqual(["Sacaton Fire", "MTZ/INYO/88A Fire", "Border 2 Fire"]);
    expect(fires[0]).toMatchObject({
      id: "530c7fa3-1421-4f31-9ce2-bdf33340691b",
      acres: 9861,
      contained: 100,
      state: "NM",
      county: "Catron",
      cause: "Natural",
      fireId: "2026-NMGNF-000354",
      location: "15 Miles E from Glenwood, NM",
    });
    expect(fires[0].coord[0]).toBeCloseTo(33.27, 2);
    expect(fires[0].coord[1]).toBeCloseTo(-108.67, 2);
    expect(fires[0].discovered).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("keeps an unreported containment as null", () => {
    expect(fires[1].contained).toBeNull();
    expect(containmentBand(fires[1].contained)).toBe("active");
  });
});

describe("parsePerimeters", () => {
  const perimeters = parsePerimeters(parsePage(jsonFixture("wfigs-perimeters.geojson")).features);

  it("joins by IRWIN id and drops perimeters with no shape", () => {
    expect(perimeters.map((p) => p.id)).toEqual([
      "aa3df707-b3f6-41b8-a5ff-bf502a918ffc",
      "542ae118-1613-43c6-8216-ebf4dde89868",
    ]);
  });

  it("drops spot-fire specks but keeps the fire's real pieces", () => {
    // 25 parts in the source; all but two are under two acres.
    expect(perimeters[0].rings).toHaveLength(2);
    expect(perimeters[1].rings).toHaveLength(1);
    expect(perimeters[0].mapped).toBeNull();
    expect(perimeters[1].mapped).toMatch(/^\d{4}-/);
  });
});

describe("parseHotspots", () => {
  it("reads position, time, power and confidence", () => {
    const spots = parseHotspots(parsePage(jsonFixture("viirs-hotspots.geojson")).features);
    expect(spots).toHaveLength(3);
    expect(spots[0]).toMatchObject({ coord: [30.4723, -91.505], frp: 95.26, satellite: "N21", confidence: "nominal" });
    expect(spots.map((s) => s.confidence)).toEqual(["nominal", "low", "high"]);
  });
});

describe("display helpers", () => {
  it("bands containment the way Watch Duty does", () => {
    expect([null, 0, 49, 50, 74, 75, 99, 100].map(containmentBand)).toEqual([
      "active",
      "active",
      "active",
      "half",
      "half",
      "most",
      "most",
      "contained",
    ]);
    expect(containmentText(null)).toBe("Containment not reported");
    expect(containmentText(82)).toBe("82% contained");
  });

  it("names fires", () => {
    expect(fireName("Sacaton")).toBe("Sacaton Fire");
    expect(fireName("Park Fire")).toBe("Park Fire");
    expect(fireName("August Complex")).toBe("August Complex");
    expect(fireName("  ")).toBe("Unnamed Fire");
    expect(irwinId("{AbC-1}")).toBe("abc-1");
  });

  it("sizes markers by acres, within bounds", () => {
    expect(fireMarkerSize(null)).toBe(8);
    expect(fireMarkerSize(0.1)).toBeLessThan(fireMarkerSize(1000));
    expect(fireMarkerSize(10_000_000)).toBe(20);
  });

  it("formats acres", () => {
    expect(formatAcres(null)).toBe("Size not reported");
    expect(formatAcres(0.1)).toBe("Under 1 acre");
    expect(formatAcres(1)).toBe("1 acre");
    expect(formatAcres(102007.4)).toBe("102,007 acres");
  });

  it("colors hotspots by age", () => {
    const now = Date.UTC(2026, 9, 11, 12);
    const hoursAgo = (h: number) => now - h * 3_600_000;
    expect(hotspotColor(hoursAgo(1), now)).toBe(HOTSPOT_AGES[0].color);
    expect(hotspotColor(hoursAgo(8), now)).toBe(HOTSPOT_AGES[1].color);
    expect(hotspotColor(hoursAgo(20), now)).toBe(HOTSPOT_AGES[2].color);
    expect(hotspotColor(hoursAgo(30), now)).toBe(HOTSPOT_AGES[2].color);
  });
});
