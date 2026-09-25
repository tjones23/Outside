import { describe, expect, it } from "vitest";
import { alertContains, parseNwsAlerts, sortAlerts } from "./alerts";
import { jsonFixture } from "./__fixtures__/load";

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
