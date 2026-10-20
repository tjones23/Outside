import { describe, expect, it } from "vitest";
import { box } from "./test-helpers";
import type { SavedLocation } from "./types";
import { keepIds, midFt, relinkFavorites, moveInOrder, queryResorts, stateAt, type Resort, type ResortQuery } from "./resorts";

const resort = (id: string, extra: Partial<Resort> = {}): Resort => ({
  id,
  name: id,
  states: ["UT"],
  lat: 40.6,
  lon: -111.6,
  pass: "independent",
  baseFt: 7000,
  topFt: 10000,
  website: null,
  webcams: null,
  ...extra,
});

const RESORTS = [
  resort("Alta Ski Area", { pass: "ikon", lat: 40.58, lon: -111.63 }),
  resort("Park City Mountain Resort", { pass: "epic", lat: 40.65, lon: -111.51 }),
  resort("Beaver Mountain", { lat: 41.97, lon: -111.54 }),
  resort("Brian Head Resort", { lat: 37.7, lon: -112.85 }),
  resort("Heavenly Mountain Resort", { states: ["CA", "NV"], pass: "epic", lat: 38.94, lon: -119.91 }),
];

const query = (patch: Partial<ResortQuery> = {}): ResortQuery => ({
  state: "UT",
  search: "",
  passes: [],
  sort: "distance",
  order: [],
  from: [40.76, -111.89], // Salt Lake City
  ...patch,
});

const names = (q: ResortQuery) => queryResorts(RESORTS, q).map((r) => r.resort.name);

describe("stateAt", () => {
  it("finds the state a point is in, holes and all", () => {
    const shapes = { UT: [box([40, -111], 2)], CO: [box([39, -105], 2), box([39, -105], 0.5)] };
    expect(stateAt(shapes, [40.6, -111.6])).toBe("UT");
    expect(stateAt(shapes, [39.8, -105.8])).toBe("CO");
    expect(stateAt(shapes, [39, -105])).toBeNull();
    expect(stateAt(shapes, [0, 0])).toBeNull();
  });
});

describe("queryResorts", () => {
  it("lists the state's resorts nearest first", () => {
    expect(names(query())).toEqual(["Alta Ski Area", "Park City Mountain Resort", "Beaver Mountain", "Brian Head Resort"]);
    expect(names(query({ state: "NV" }))).toEqual(["Heavenly Mountain Resort"]);
  });

  it("falls back to A to Z without a location", () => {
    expect(names(query({ from: null }))[0]).toBe("Alta Ski Area");
    expect(queryResorts(RESORTS, query({ from: null }))[0].miles).toBeNull();
  });

  it("filters by pass and by name, ignoring case and accents", () => {
    expect(names(query({ passes: ["epic", "ikon"] }))).toEqual(["Alta Ski Area", "Park City Mountain Resort"]);
    expect(names(query({ passes: ["independent"] }))).toEqual(["Beaver Mountain", "Brian Head Resort"]);
    expect(names(query({ search: "BRÍAN" }))).toEqual(["Brian Head Resort"]);
  });

  it("keeps a custom order, with resorts not in it after, nearest first", () => {
    expect(names(query({ sort: "custom", order: ["Brian Head Resort", "Beaver Mountain"] }))).toEqual([
      "Brian Head Resort",
      "Beaver Mountain",
      "Alta Ski Area",
      "Park City Mountain Resort",
    ]);
  });
});

describe("moveInOrder", () => {
  it("swaps with the neighbor, and stops at the ends", () => {
    expect(moveInOrder(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveInOrder(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveInOrder(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });
});

describe("midFt", () => {
  it("is halfway up, or whichever end is known", () => {
    expect(midFt(resort("a"))).toBe(8500);
    expect(midFt(resort("a", { baseFt: null }))).toBe(10000);
    expect(midFt(resort("a", { baseFt: null, topFt: null }))).toBeNull();
  });
});

describe("keepIds", () => {
  const at = (id: string, name: string, lat: number, lon: number, states = ["UT"]) =>
    resort(id, { name, lat, lon, states });

  it("restores a reissued id by name", () => {
    const { resorts, carried } = keepIds([at("old", "Alta Ski Area", 40.58, -111.63)], [at("new", "Alta Ski Area", 40.59, -111.64)]);
    expect(resorts.map((r) => r.id)).toEqual(["old"]);
    expect(carried).toHaveLength(1);
  });

  it("restores a renamed and reissued resort that hasn't moved", () => {
    const { resorts } = keepIds([at("old", "Ski Mystic", 40.58, -111.63)], [at("new", "Deer Mountain", 40.585, -111.63)]);
    expect(resorts[0].id).toBe("old");
  });

  it("leaves a new resort alone when the vanished one was elsewhere", () => {
    const { resorts, carried } = keepIds([at("old", "Closed Hill", 40.58, -111.63)], [at("new", "New Hill", 40.7, -111.63)]);
    expect(resorts[0].id).toBe("new");
    expect(carried).toEqual([]);
  });

  it("needs a shared state", () => {
    const { resorts } = keepIds([at("old", "Hidden Valley", 38.5, -90.7, ["MO"])], [at("new", "Hidden Valley", 40.0, -79.2, ["PA"])]);
    expect(resorts[0].id).toBe("new");
  });

  it("prefers a name match to a nearer neighbor, one id each", () => {
    const { resorts } = keepIds(
      [at("alta", "Alta Ski Area", 40.58, -111.63), at("bird", "Snowbird", 40.58, -111.65)],
      [at("n1", "Snowbird", 40.581, -111.631), at("n2", "Alta Ski Area", 40.58, -111.651)],
    );
    expect(resorts.map((r) => r.id)).toEqual(["bird", "alta"]);
  });

  it("keeps ids that didn't change", () => {
    const same = at("same", "Brighton Resort", 40.6, -111.58);
    expect(keepIds([same], [same]).resorts).toEqual([same]);
  });
});

describe("relinkFavorites", () => {
  const RESORTS = [
    resort("alta-new", { name: "Alta Ski Area", lat: 40.574, lon: -111.636 }),
    resort("bird", { name: "Snowbird", lat: 40.582, lon: -111.649 }),
  ];
  const saved = (id: string, name: string, lat: number, lon: number, resortId?: string): SavedLocation => ({
    id,
    name,
    lat,
    lon,
    addedAt: 0,
    ...(resortId ? { resortId } : {}),
  });

  it("relinks a favorite whose resort id is gone to the resort it was saved from", () => {
    const moves = relinkFavorites([saved("s1", "Alta Ski Area", 40.581, -111.625, "alta-old")], RESORTS);
    expect([...moves]).toEqual([["s1", "alta-new"]]);
  });

  it("prefers the same name to a nearer neighbor", () => {
    const moves = relinkFavorites([saved("s1", "Alta Ski Area", 40.581, -111.645, "alta-old")], RESORTS);
    expect(moves.get("s1")).toBe("alta-new");
  });

  it("finds a renamed favorite by distance", () => {
    const moves = relinkFavorites([saved("s1", "My powder day", 40.575, -111.636, "alta-old")], RESORTS);
    expect(moves.get("s1")).toBe("alta-new");
  });

  it("doesn't link a second favorite to a resort that already has one, or to its neighbor", () => {
    const moves = relinkFavorites(
      [saved("s1", "Alta", 40.574, -111.636, "alta-new"), saved("s2", "Alta Ski Area", 40.575, -111.636, "alta-old")],
      RESORTS,
    );
    expect(moves.size).toBe(0);
  });

  it("leaves favorites alone when their resort is still there, they aren't resorts, or nothing is close", () => {
    const moves = relinkFavorites(
      [
        saved("s1", "Snowbird", 40.582, -111.649, "bird"),
        saved("s2", "Home", 40.575, -111.636),
        saved("s3", "Closed Hill", 41.5, -111.6, "gone"),
      ],
      RESORTS,
    );
    expect(moves.size).toBe(0);
  });
});
