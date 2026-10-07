import { describe, expect, it } from "vitest";
import {
  alertContains,
  byPriority,
  capId,
  parseAffectedZones,
  parseNwsAlerts,
  parseWwaOutlines,
  parseZoneOutline,
  sortAlerts,
  withOutlines,
  zonesStillNeeded,
} from "./alerts";
import { jsonFixture } from "./__fixtures__/load";
import { joinOutlines } from "./sources/upstream";
import { box, makeAlert } from "./test-helpers";

const alerts = parseNwsAlerts(jsonFixture("nws-alerts.json"));
const byEvent = (event: string) => alerts.find((a) => a.event === event)!;

describe("parseNwsAlerts", () => {
  it("keeps alerts with an event and skips the rest", () => {
    expect(alerts.map((a) => a.event)).toEqual([
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Tornado Watch",
    ]);
  });

  it("derives category, kind, rank and color", () => {
    const tor = byEvent("Tornado Warning");
    expect(tor).toMatchObject({
      category: "tornado",
      group: "severe",
      level: "warning",
      stormBased: true,
      isWarning: true,
      isWatch: false,
      severityRank: 0,
      color: "#FF0000",
    });
    expect(byEvent("Severe Thunderstorm Warning")).toMatchObject({
      category: "wind",
      severityRank: 1,
      color: "#FFA500",
    });
    expect(byEvent("Tornado Watch")).toMatchObject({ isWatch: true, isWarning: false });
  });

  it("gives a watch without geometry no polygons and no centroid", () => {
    const watch = byEvent("Tornado Watch");
    expect(watch.polygons).toEqual([]);
    expect(watch.centroid).toBeNull();
  });

  it("reads every polygon of a MultiPolygon and places the centroid on the first", () => {
    const svr = byEvent("Severe Thunderstorm Warning");
    expect(svr.polygons).toHaveLength(2);
    expect(svr.centroid![0]).toBeCloseTo(36.16, 1);
  });

  it("tests containment", () => {
    const tor = byEvent("Tornado Warning");
    expect(alertContains(tor, [35.34, -97.49])).toBe(true);
    expect(alertContains(tor, [36.15, -95.99])).toBe(false);
  });

  it("survives garbage", () => {
    expect(parseNwsAlerts(null)).toEqual([]);
    expect(parseNwsAlerts({ features: "no" })).toEqual([]);
  });
});

describe("sortAlerts", () => {
  const events = (list: typeof alerts) => list.map((a) => a.event);

  it("sorts newest first by default", () => {
    expect(events(sortAlerts(alerts, "recent", false, null))).toEqual([
      "Severe Thunderstorm Warning",
      "Tornado Warning",
      "Tornado Watch",
    ]);
    expect(events(sortAlerts(alerts, "recent", true, null))[0]).toBe("Tornado Watch");
  });

  it("sorts most severe first, newest breaking ties", () => {
    // Warning and watch are both "Severe"; the warning is newer.
    expect(events(sortAlerts(alerts, "severity", false, null))).toEqual([
      "Tornado Warning",
      "Severe Thunderstorm Warning",
      "Tornado Watch",
    ]);
    expect(events(sortAlerts(alerts, "severity", true, null))[2]).toBe("Tornado Warning");
  });

  it("sorts nearest first, with unplaceable alerts last", () => {
    const tulsa: [number, number] = [36.15, -95.99];
    expect(events(sortAlerts(alerts, "distance", false, tulsa))).toEqual([
      "Severe Thunderstorm Warning",
      "Tornado Warning",
      "Tornado Watch",
    ]);
  });

  it("falls back to newest first without a location", () => {
    expect(sortAlerts(alerts, "distance", false, null)).toEqual(
      sortAlerts(alerts, "recent", false, null),
    );
  });

  it("does not mutate its input", () => {
    const before = events(alerts);
    sortAlerts(alerts, "severity", true, null);
    expect(events(alerts)).toEqual(before);
  });
});

describe("every NWS alert, not just the convective ones", () => {
  const json = jsonFixture("nws-alerts-zones.json");
  const zoned = parseNwsAlerts(json);
  const heat = zoned.find((a) => a.event === "Heat Advisory")!;
  const watch = zoned.find((a) => a.event === "Hurricane Watch")!;

  it("skips cancellations and keeps unknown events", () => {
    expect(zoned.map((a) => a.event)).toEqual(["Heat Advisory", "Hurricane Watch", "Volcanic Smog Advisory"]);
    expect(zoned[2]).toMatchObject({ group: "other", level: "advisory", category: null });
  });

  it("classifies non-convective alerts without a storm category", () => {
    expect(heat).toMatchObject({
      group: "heat",
      level: "advisory",
      category: null,
      stormBased: false,
      isWarning: false,
      isWatch: false,
      instruction: "Drink plenty of fluids.",
    });
    expect(watch).toMatchObject({ group: "tropical", level: "watch", isWatch: true });
  });

  it("runs until the hazard ends, not until the message expires", () => {
    expect(heat.expires).toBe("2026-10-08T20:00:00-05:00");
    expect(watch.expires).toBe("2026-10-07T22:00:00-05:00");
  });

  it("reads each alert's zones, dropping anything that isn't an NWS zone", () => {
    const zones = parseAffectedZones(json);
    expect(zones.get(heat.id)).toHaveLength(2);
    expect(zones.get(watch.id)).toEqual(["https://api.weather.gov/zones/forecast/LAZ073"]);
  });

  it("takes the CAP id from the end of the alert URL", () => {
    expect(capId(heat.id)).toBe("urn:oid:2.49.0.1.840.0.heat.001.1");
  });

  it("joins the map service's outlines by CAP id, merging every feature", () => {
    const byCap = parseWwaOutlines(jsonFixture("nws-wwa-outlines.json"));
    // The storm surge outline has no CAP id, so it can't be joined.
    expect([...byCap.keys()]).toEqual(["urn:oid:2.49.0.1.840.0.heat.001.1"]);
    const [outlined] = withOutlines([heat], byCap);
    expect(outlined.polygons).toHaveLength(2);
    expect(alertContains(outlined, [32.75, -96.75])).toBe(true);
    expect(alertContains(outlined, [32.75, -97.3])).toBe(true);
    expect(outlined.centroid).not.toBeNull();
    // Still not storm-based: its outline is the zones'.
    expect(outlined.stormBased).toBe(false);
  });

  it("falls back to zone outlines for alerts the map service lacks", () => {
    const byCap = parseWwaOutlines(jsonFixture("nws-wwa-outlines.json"));
    const zonesOf = parseAffectedZones(json);
    expect(zonesStillNeeded(zoned, byCap, zonesOf)).toEqual(["https://api.weather.gov/zones/forecast/LAZ073"]);

    const byZone = new Map([["https://api.weather.gov/zones/forecast/LAZ073", [box([29.8, -93.3])]]]);
    const out = withOutlines(zoned, byCap, zonesOf, byZone);
    expect(out.find((a) => a.id === watch.id)!.polygons).toHaveLength(1);
    // Nothing known about it: listed, not drawn.
    expect(out[2].polygons).toEqual([]);
  });

  it("leaves storm-based polygons alone", () => {
    const tor = byEvent("Tornado Warning");
    const [same] = withOutlines([tor], new Map([[capId(tor.id), [box([0, 0])]]]));
    expect(same).toBe(tor);
  });

  it("joins everything through the upstream helper, looking up each missing zone once", async () => {
    const asked: string[] = [];
    const out = await joinOutlines(
      { alerts: zoned, zones: Object.fromEntries(parseAffectedZones(json)) },
      Object.fromEntries(parseWwaOutlines(jsonFixture("nws-wwa-outlines.json"))),
      async (url) => {
        asked.push(url);
        return [box([29.8, -93.3])];
      },
    );
    expect(asked).toEqual(["https://api.weather.gov/zones/forecast/LAZ073"]);
    expect(out.filter((a) => a.polygons.length > 0)).toHaveLength(2);
  });

  it("still lists every alert when the outlines are unavailable", async () => {
    const out = await joinOutlines({ alerts: zoned, zones: {} }, null, async () => null);
    expect(out).toHaveLength(3);
  });
});

describe("parseZoneOutline", () => {
  it("simplifies and rounds a zone's outline", () => {
    // A square with a hundred near-collinear points along one edge.
    const edge = Array.from({ length: 100 }, (_, i) => [-97 + i * 0.005, 35 + (i % 2) * 0.0001]);
    const ring = [...edge, [-96.5, 35], [-96.5, 35.5], [-97, 35.5], [-97, 35]];
    const [outline] = parseZoneOutline({ geometry: { type: "Polygon", coordinates: [ring] } });
    expect(outline.length).toBeLessThan(10);
    expect(outline.every(([lat, lon]) => Number(lat.toFixed(3)) === lat && Number(lon.toFixed(3)) === lon)).toBe(true);
  });

  it("returns nothing for a zone without geometry", () => {
    expect(parseZoneOutline({ geometry: null })).toEqual([]);
  });
});

describe("byPriority and severity sort", () => {
  it("puts the more important event first", () => {
    const heat = makeAlert("Heat Advisory", []);
    const tor = makeAlert("Tornado Warning", []);
    expect([heat, tor].sort(byPriority).map((a) => a.event)).toEqual(["Tornado Warning", "Heat Advisory"]);
  });

  it("treats an alert you're inside as distance zero", () => {
    const big = makeAlert("Heat Advisory", [box([35, -97], 3)], { centroid: [37.9, -94.1] });
    const small = makeAlert("Flood Warning", [box([35.6, -97], 0.1)], { centroid: [35.6, -97] });
    expect(sortAlerts([small, big], "distance", false, [35, -97])[0]).toBe(big);
  });
});
