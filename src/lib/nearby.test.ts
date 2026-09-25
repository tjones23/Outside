import { describe, expect, it } from "vitest";
import { reportsNear, savedLocationStatus, warningsContaining } from "./nearby";
import { box, makeAlert, makeReport } from "./test-helpers";
import type { LatLng, SavedLocation } from "./types";

const home: LatLng = [35.34, -97.49];
const north = ([lat, lon]: LatLng, mi: number): LatLng => [lat + mi / 69.05, lon];
const location: SavedLocation = { id: "1", name: "Home", lat: home[0], lon: home[1], addedAt: 0 };

describe("warningsContaining", () => {
  it("counts warnings only, never watches", () => {
    const warning = makeAlert("Tornado Warning", [box(home)]);
    const watch = makeAlert("Tornado Watch", [box(home)]);
    const elsewhere = makeAlert("Tornado Warning", [box([40, -90])]);
    expect(warningsContaining([warning, watch, elsewhere], home)).toEqual([warning]);
  });
});

describe("reportsNear", () => {
  it("keeps reports within 50 miles, nearest first", () => {
    const far = makeReport("hail", north(home, 60));
    const mid = makeReport("hail", north(home, 30));
    const near = makeReport("hail", north(home, 5));
    const got = reportsNear([far, mid, near], home);
    expect(got.map((r) => r.report)).toEqual([near, mid]);
    expect(got[0].miles).toBeCloseTo(5, 0);
  });
});

describe("savedLocationStatus", () => {
  it("prefers a warning over nearby reports", () => {
    const warning = makeAlert("Tornado Warning", [box(home)], { color: "#FF0000" });
    const status = savedLocationStatus(location, [warning], [makeReport("hail", home)]);
    expect(status).toEqual({ label: "Tornado Warning", tone: "alert", color: "#FF0000" });
  });

  it("counts nearby reports", () => {
    expect(savedLocationStatus(location, [], [makeReport("hail", home)]).label).toBe(
      "1 report within 50 mi",
    );
    expect(
      savedLocationStatus(location, [], [makeReport("hail", home), makeReport("wind", home)]).label,
    ).toBe("2 reports within 50 mi");
  });

  it("is quiet otherwise", () => {
    expect(savedLocationStatus(location, [], []).tone).toBe("quiet");
  });
});
