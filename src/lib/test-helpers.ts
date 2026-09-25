import type { LatLng, Ring, StormAlert, StormCategory, StormReport } from "./types";

/** Minimal builders for tests. Not imported by app code. */

let seq = 0;

export function makeReport(
  category: StormCategory,
  coord: LatLng,
  extra: Partial<StormReport> = {},
): StormReport {
  return {
    id: `r${seq++}`,
    category,
    time: "1200",
    magnitude: "",
    location: "Somewhere",
    county: "",
    state: "OK",
    coord,
    comments: "",
    date: "2026-05-20",
    title: "",
    subtitle: "",
    windMph: null,
    hailInches: null,
    efRating: null,
    ...extra,
  };
}

/** A square about `half` degrees either side of `center`. */
export function box([lat, lon]: LatLng, half = 0.2): Ring {
  return [
    [lat - half, lon - half],
    [lat - half, lon + half],
    [lat + half, lon + half],
    [lat + half, lon - half],
  ];
}

export function makeAlert(event: string, polygons: Ring[], extra: Partial<StormAlert> = {}): StormAlert {
  return {
    id: `a${seq++}`,
    event,
    headline: null,
    areaDesc: "Somewhere County",
    severity: "Severe",
    effective: null,
    expires: null,
    senderName: null,
    description: null,
    polygons,
    category: /tornado/i.test(event) ? "tornado" : "wind",
    isWarning: /warning/i.test(event),
    isWatch: /watch/i.test(event),
    severityRank: 1,
    color: "#FF0000",
    centroid: null,
    ...extra,
  };
}
