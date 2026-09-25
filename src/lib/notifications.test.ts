import { describe, expect, it } from "vitest";
import { DEFAULT_FILTERS } from "./filters";
import { planNotifications } from "./notifications";
import { box, makeAlert } from "./test-helpers";
import type { LatLng, SavedLocation } from "./types";

const home: LatLng = [35.34, -97.49];
const locations: SavedLocation[] = [{ id: "1", name: "Home", lat: home[0], lon: home[1], addedAt: 0 }];
const atHome = makeAlert("Tornado Warning", [box(home)], { areaDesc: "Cleveland, OK" });
const away = makeAlert("Severe Thunderstorm Warning", [box([40, -90])], { areaDesc: "Cook, IL" });
const watch = makeAlert("Tornado Watch", [box(home)]);
const both = { savedLocationAlerts: true, anyWarningAlerts: true };

describe("planNotifications", () => {
  it("only records a baseline on the first run", () => {
    const plan = planNotifications({
      alerts: [atHome, away],
      seen: null,
      settings: both,
      locations,
      filters: DEFAULT_FILTERS,
    });
    expect(plan.toShow).toEqual([]);
    expect(plan.nextSeen).toEqual([atHome.id, away.id]);
  });

  it("names the saved location, and doesn't repeat it as a general warning", () => {
    const plan = planNotifications({
      alerts: [atHome, away],
      seen: [],
      settings: both,
      locations,
      filters: DEFAULT_FILTERS,
    });
    expect(plan.toShow).toEqual([
      { id: atHome.id, title: "Tornado Warning", body: "Home: Cleveland, OK" },
      { id: away.id, title: "Severe Thunderstorm Warning", body: "Cook, IL" },
    ]);
  });

  it("never notifies for watches, and never twice", () => {
    const plan = planNotifications({
      alerts: [atHome, watch],
      seen: [atHome.id],
      settings: both,
      locations,
      filters: DEFAULT_FILTERS,
    });
    expect(plan.toShow).toEqual([]);
    expect(plan.nextSeen).toEqual([atHome.id]);
  });

  it("filters general warnings but not saved-location ones", () => {
    const plan = planNotifications({
      alerts: [atHome, away],
      seen: [],
      settings: both,
      locations,
      filters: { ...DEFAULT_FILTERS, showWind: false, showTornado: false },
    });
    expect(plan.toShow.map((n) => n.id)).toEqual([atHome.id]);
  });

  it("with only saved-location alerts on, ignores warnings elsewhere", () => {
    const plan = planNotifications({
      alerts: [away],
      seen: [],
      settings: { savedLocationAlerts: true, anyWarningAlerts: false },
      locations,
      filters: DEFAULT_FILTERS,
    });
    expect(plan.toShow).toEqual([]);
  });

  it("still updates the baseline with notifications off", () => {
    const plan = planNotifications({
      alerts: [atHome],
      seen: ["expired"],
      settings: { savedLocationAlerts: false, anyWarningAlerts: false },
      locations,
      filters: DEFAULT_FILTERS,
    });
    expect(plan.toShow).toEqual([]);
    expect(plan.nextSeen).toEqual([atHome.id]);
  });
});
