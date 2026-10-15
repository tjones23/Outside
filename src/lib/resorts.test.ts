import { describe, expect, it } from "vitest";
import { box } from "./test-helpers";
import { midFt, moveInOrder, queryResorts, stateAt, type Resort, type ResortQuery } from "./resorts";

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
