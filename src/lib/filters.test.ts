import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS, normalizeFilters, passesAlert, passesReport, selectedOutlook } from "./filters";
import { makeAlert, makeReport } from "./test-helpers";

const f = (patch = {}) => ({ ...DEFAULT_FILTERS, ...patch });
const here: [number, number] = [35, -97];

describe("passesReport", () => {
  it("drops disabled categories", () => {
    expect(passesReport(f({ showHail: false }), makeReport("hail", here))).toBe(false);
    expect(passesReport(f(), makeReport("hail", here))).toBe(true);
  });

  it("keeps unrated reports while no minimum is set", () => {
    expect(passesReport(f(), makeReport("wind", here))).toBe(true);
    expect(passesReport(f(), makeReport("tornado", here))).toBe(true);
  });

  it("applies minimums and drops unrated reports once one is set", () => {
    const wind = f({ minWindMph: 70 });
    expect(passesReport(wind, makeReport("wind", here, { windMph: 75 }))).toBe(true);
    expect(passesReport(wind, makeReport("wind", here, { windMph: 65 }))).toBe(false);
    expect(passesReport(wind, makeReport("wind", here))).toBe(false);

    const hail = f({ minHailInches: 1 });
    expect(passesReport(hail, makeReport("hail", here, { hailInches: 1 }))).toBe(true);
    expect(passesReport(hail, makeReport("hail", here, { hailInches: 0.75 }))).toBe(false);

    const tor = f({ minTornadoRating: 0 });
    expect(passesReport(tor, makeReport("tornado", here, { efRating: 0 }))).toBe(true);
    expect(passesReport(tor, makeReport("tornado", here))).toBe(false);
  });
});

describe("passesAlert", () => {
  const warning = makeAlert("Tornado Warning", []);
  const watch = makeAlert("Tornado Watch", []);

  it("filters warnings and watches independently", () => {
    expect(passesAlert(f({ showWatches: false }), watch)).toBe(false);
    expect(passesAlert(f({ showWatches: false }), warning)).toBe(true);
    expect(passesAlert(f({ showWarnings: false }), warning)).toBe(false);
  });

  it("respects the category", () => {
    expect(passesAlert(f({ showTornado: false }), warning)).toBe(false);
  });
});

describe("normalizeFilters", () => {
  it("fills in whatever is missing", () => {
    expect(normalizeFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(normalizeFilters({ showHail: false })).toEqual({ ...DEFAULT_FILTERS, showHail: false });
  });

  it("ignores wrong types and clamps ranges", () => {
    const n = normalizeFilters({
      showWind: "yes",
      reportDays: 12,
      radarOpacity: 0,
      minHailInches: -2,
      minTornadoRating: 9,
      outlookKind: "sharknado",
    });
    expect(n.showWind).toBe(true);
    expect(n.reportDays).toBe(5);
    expect(n.radarOpacity).toBe(0.1);
    expect(n.minHailInches).toBe(0);
    expect(n.minTornadoRating).toBe(5);
    expect(n.outlookKind).toBeNull();
  });

  it("clamps the outlook day to one the kind publishes", () => {
    expect(normalizeFilters({ outlookKind: "hail", outlookDay: 3 }).outlookDay).toBe(1);
    expect(normalizeFilters({ outlookKind: "categorical", outlookDay: 3 }).outlookDay).toBe(3);
  });
});

describe("selectedOutlook", () => {
  it("is null with no outlook chosen", () => {
    expect(selectedOutlook(f())).toBeNull();
  });

  it("clamps the day", () => {
    expect(selectedOutlook(f({ outlookKind: "wind", outlookDay: 3 }))!.id).toBe("day1_wind");
  });
});
