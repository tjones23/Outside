import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  normalizeAlertsFilters,
  normalizeFilters,
  passesAlert,
  passesReport,
  selectedOutlook,
  withinReportDays,
} from "./filters";
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

describe("withinReportDays", () => {
  const days = ["2026-05-20", "2026-05-19", "2026-05-18"].map((date) => ({ date, ok: true, count: 1 }));
  const reports = days.map((d) => makeReport("hail", here, { date: d.date }));

  it("keeps the newest days asked for", () => {
    expect(withinReportDays(reports, days, 1)).toEqual([reports[0]]);
    expect(withinReportDays(reports, days, 2)).toEqual(reports.slice(0, 2));
  });

  it("keeps everything when the feed covers no more days than asked", () => {
    expect(withinReportDays(reports, days, 3)).toBe(reports);
    expect(withinReportDays(reports, days, 5)).toBe(reports);
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

  it("ignores storm types on the alerts page, which has no chips for them", () => {
    const saved = normalizeAlertsFilters(f({ showTornado: false, showWind: false, showHail: false, showWatches: false }));
    expect(passesAlert(saved, warning)).toBe(true);
    expect(passesAlert(saved, watch)).toBe(false);
  });

  it("leaves the storm categories out of non-convective alerts", () => {
    const heat = makeAlert("Heat Advisory", []);
    expect(passesAlert(f({ showTornado: false, showWind: false, showHail: false }), heat)).toBe(true);
  });

  it("filters advisories and statements as tiers of their own", () => {
    const advisory = makeAlert("Coastal Flood Advisory", []);
    const statement = makeAlert("Coastal Flood Statement", []);
    expect(passesAlert(f(), advisory)).toBe(true);
    expect(passesAlert(f({ showAdvisories: false }), advisory)).toBe(false);
    // Statements are off until asked for.
    expect(passesAlert(f(), statement)).toBe(false);
    expect(passesAlert(f({ showStatements: true }), statement)).toBe(true);
  });

  it("filters by hazard family, with marine off by default", () => {
    expect(passesAlert(f(), makeAlert("Small Craft Advisory", []))).toBe(false);
    expect(passesAlert(f({ alertGroups: ["marine"] }), makeAlert("Small Craft Advisory", []))).toBe(true);
    expect(passesAlert(f({ alertGroups: ["severe"] }), makeAlert("Heat Advisory", []))).toBe(false);
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
    expect(normalizeFilters({ outlookKind: "rainfall", outlookDay: 5 }).outlookDay).toBe(5);
  });

  it("drops the basemap choice older settings stored", () => {
    expect(normalizeFilters({ basemap: "gray" })).toEqual(DEFAULT_FILTERS);
  });

  it("keeps only known alert groups, in catalog order", () => {
    expect(normalizeFilters({ alertGroups: ["heat", "bogus", "severe"] }).alertGroups).toEqual(["severe", "heat"]);
    expect(normalizeFilters({ alertGroups: "heat" }).alertGroups).toEqual(DEFAULT_FILTERS.alertGroups);
    expect(normalizeFilters({ alertGroups: [] }).alertGroups).toEqual([]);
  });

  it("never runs radar and a forecast animation at once", () => {
    expect(normalizeFilters({ showRadar: true, forecastProduct: "hrrr-refd" })).toMatchObject({
      showRadar: false,
      forecastProduct: "hrrr-refd",
    });
    expect(normalizeFilters({ showRadar: true, forecastProduct: "gfs" })).toMatchObject({
      showRadar: true,
      forecastProduct: null,
    });
  });

  it("reads settings saved before alerts, tropical, forecasts and wildfire existed", () => {
    const old = { ...DEFAULT_FILTERS } as Record<string, unknown>;
    for (const k of [
      "alertGroups",
      "showAdvisories",
      "showStatements",
      "showTropical",
      "forecastProduct",
      "showFires",
      "showHotspots",
      "showSmoke",
      "showAirQuality",
    ]) {
      delete old[k];
    }
    expect(normalizeFilters(old)).toEqual(DEFAULT_FILTERS);
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
