import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import {
  compass,
  currentStage,
  ktToMph,
  parseCoastal,
  parseCone,
  parseCurrentStorms,
  parseDisturbances,
  parseForecastPoints,
  parseLayerIndex,
  parseOutlookAreas,
  parsePastTrack,
  parseTrack,
  stormLayerId,
  stormTitle,
} from "./tropical";

describe("parseCurrentStorms", () => {
  const [storm] = parseCurrentStorms(jsonFixture("nhc-current-storms.json"));

  it("reads the storm list", () => {
    expect(storm).toMatchObject({
      id: "al092026",
      bin: "AT4",
      name: "Isaias",
      classification: "TS",
      title: "Tropical Storm Isaias",
      windMph: 45,
      pressureMb: 1000,
      position: [22.4, -93.6],
      movement: "ENE at 8 mph",
      advisoryNumber: "004",
    });
    expect(storm.links.map((l) => l.label)).toEqual(["Public advisory", "Forecast discussion", "NHC graphics"]);
  });

  it("survives garbage", () => {
    expect(parseCurrentStorms(null)).toEqual([]);
    expect(parseCurrentStorms({ activeStorms: [{ id: "x" }] })).toEqual([]);
  });
});

describe("storm layers", () => {
  it("finds each storm's layers by name", () => {
    const index = parseLayerIndex(jsonFixture("nhc-layers.json"));
    expect(stormLayerId(index, "AT4", "points")).toBe(84);
    expect(stormLayerId(index, "AT4", "cone")).toBe(86);
    expect(stormLayerId(index, "AT4", "past")).toBe(90);
    expect(stormLayerId(index, "AT9", "points")).toBeNull();
  });

  it("reads forecast points in time order, with NHC's stage letters", () => {
    const points = parseForecastPoints(jsonFixture("nhc-points.json"));
    expect(points).toHaveLength(8);
    expect(points[0]).toMatchObject({ tau: 0, stage: "S", windKt: 40, coord: [22.4, -93.6] });
    expect(points.map((p) => p.stage).join("")).toBe("SSHHHHSD");
    expect(points[2].stageName).toBe("Hurricane");
    expect(points[1].label).toBe("7:00 PM Wed CDT");
  });

  it("reads the track, cone, coastal alerts and past track", () => {
    expect(parseTrack(jsonFixture("nhc-track.json")).length).toBeGreaterThan(5);
    const cone = parseCone(jsonFixture("nhc-cone.json"));
    expect(cone).toHaveLength(1);
    expect(cone[0].length).toBeGreaterThan(50);
    expect(parseCoastal(jsonFixture("nhc-ww.json")).map((c) => c.kind)).toEqual(["TWA", "TWA", "HWA"]);
    expect(parsePastTrack(jsonFixture("nhc-past.json")).map((s) => s.stormType)).toEqual(["DB", "TD", "TD"]);
  });

  it("reads the outlook's areas and disturbances", () => {
    const areas = parseOutlookAreas(jsonFixture("nhc-gtwo-areas.json"));
    expect(areas.map((a) => [a.risk7day, a.prob7day])).toEqual([
      ["High", "90%"],
      ["Low", "30%"],
    ]);
    const [d] = parseDisturbances(jsonFixture("nhc-gtwo-points.json"));
    expect(d).toMatchObject({ basin: "Pacific", prob2day: "90%" });
  });
});

describe("helpers", () => {
  it("converts knots the way NHC rounds them", () => {
    expect(ktToMph(40)).toBe(45);
    expect(ktToMph(70)).toBe(80);
    expect(ktToMph(100)).toBe(115);
  });

  it("names compass points", () => {
    expect(compass(0)).toBe("N");
    expect(compass(70)).toBe("ENE");
    expect(compass(285)).toBe("WNW");
    expect(compass(359)).toBe("N");
  });

  it("titles storms by classification", () => {
    expect(stormTitle("HU", "Rachel")).toBe("Hurricane Rachel");
    expect(stormTitle("PTC", "One")).toBe("Potential Tropical Cyclone One");
  });

  it("knows a storm's stage now, with or without forecast points", () => {
    const [storm] = parseCurrentStorms(jsonFixture("nhc-current-storms.json"));
    expect(currentStage(storm)).toBe("S");
    expect(currentStage({ ...storm, classification: "HU", windMph: 120 })).toBe("M");
  });
});
