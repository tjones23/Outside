import { outlookColor, outlookFillDark, outlookFillLight, outlookStrokeDark, outlookStrokeLight, toHex } from "./color";
import { polygons as geoPolygons } from "./geojson";
import { hatchSegments } from "./hatch";
import type { Theme } from "./theme";
import type { OutlookData, OutlookFeature, OutlookKind, OutlookProduct, Ring } from "./types";

/**
 * SPC convective outlooks. Ported from `Outlook.cs` and `SpcOutlookService.cs`.
 *
 * One product is a day plus a kind: categorical risk for days 1–3, or the
 * tornado / wind / hail probabilities for days 1–2.
 *
 * WPC's Excessive Rainfall Outlook (days 1–5) rides along as one more kind.
 * It's published as GeoJSON too, with its risk as a number (`dn`) instead of
 * SPC's label and colors, which `buildOutlook` fills in.
 */

export const OUTLOOK_KINDS: readonly OutlookKind[] = ["categorical", "tornado", "wind", "hail", "rainfall"];

const SLUG: Record<OutlookKind, string> = {
  categorical: "cat",
  tornado: "torn",
  wind: "wind",
  hail: "hail",
  rainfall: "ero",
};

const TITLE: Record<OutlookKind, string> = {
  categorical: "Categorical",
  tornado: "Tornado",
  wind: "Wind",
  hail: "Hail",
  rainfall: "Excessive Rainfall",
};

/** Short names for the Filters chips. */
const CHIP_TITLE: Record<OutlookKind, string> = { ...TITLE, rainfall: "Excessive rain" };

export function outlookKindChip(kind: OutlookKind): string {
  return CHIP_TITLE[kind];
}

export function isOutlookKind(value: unknown): value is OutlookKind {
  return typeof value === "string" && (OUTLOOK_KINDS as readonly string[]).includes(value);
}

export function outlookKindTitle(kind: OutlookKind): string {
  return TITLE[kind];
}

/** Days SPC publishes for a kind. */
export function availableDays(kind: OutlookKind): number[] {
  if (kind === "rainfall") return [1, 2, 3, 4, 5];
  return kind === "categorical" ? [1, 2, 3] : [1, 2];
}

/** `day` clamped to one the kind actually publishes. */
export function clampDay(kind: OutlookKind, day: number): number {
  const days = availableDays(kind);
  return days.includes(day) ? day : days[0];
}

export function outlookProduct(day: number, kind: OutlookKind): OutlookProduct {
  const slug = SLUG[kind];
  if (kind === "rainfall") {
    return {
      day,
      kind,
      center: "WPC",
      id: `day${day}_${slug}`,
      title: `Day ${day} ${TITLE[kind]}`,
      url: `https://www.wpc.ncep.noaa.gov/exper/eromap/geojson/Day${day}_Latest.geojson`,
      discussionUrl: "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php",
    };
  }
  return {
    day,
    kind,
    center: "SPC",
    id: `day${day}_${slug}`,
    title: `Day ${day} ${TITLE[kind]}`,
    url: `https://www.spc.noaa.gov/products/outlook/day${day}otlk_${slug}.nolyr.geojson`,
    discussionUrl: `https://www.spc.noaa.gov/products/outlook/day${day}otlk.html`,
  };
}

/** SPC marks "conditional intensity" areas with hatching. */
export function detectHatched(label: string, detail: string): boolean {
  return /^cig/i.test(label) || /conditional intensity/i.test(detail);
}

export function isGeneralThunderstorm(label: string, detail: string): boolean {
  return label.toUpperCase() === "TSTM" || /general thunderstorm/i.test(detail);
}

/**
 * Outline and slashes for hatched areas. SPC draws them black, which vanishes
 * on the dark basemap; a pale line reads as "pattern" there the way black
 * does on the light one.
 */
export const HATCH_COLOR = "#E4E4EC";
export const HATCH_COLOR_LIGHT = "#1B1B23";

/** A feature's map colors for the basemap on screen. */
export function featureColors(f: OutlookFeature, theme: Theme): { fill: string; stroke: string } {
  return theme === "light"
    ? { fill: f.fillColorLight, stroke: f.strokeColorLight }
    : { fill: f.fillColor, stroke: f.strokeColor };
}

/** Hatching falls back to this latitude when no area is hatched. */
const DEFAULT_REF_LAT = 39.5;

function prop(props: unknown, key: string): string | null {
  const v = (props as Record<string, unknown> | null)?.[key];
  return typeof v === "string" ? v : null;
}

/**
 * WPC's four Excessive Rainfall risk levels, in SPC's categorical colors —
 * WPC's own map uses the same green / yellow / red / magenta.
 */
const ERO_LEVELS: Record<number, { label: string; detail: string; fill: string; stroke: string }> = {
  1: { label: "MRGL", detail: "Marginal Risk of Excessive Rainfall (≥5%)", fill: "#66A366", stroke: "#005500" },
  2: { label: "SLGT", detail: "Slight Risk of Excessive Rainfall (≥15%)", fill: "#FFE066", stroke: "#DDAA00" },
  3: { label: "MDT", detail: "Moderate Risk of Excessive Rainfall (≥40%)", fill: "#E06666", stroke: "#CC0000" },
  4: { label: "HIGH", detail: "High Risk of Excessive Rainfall (≥70%)", fill: "#EE99EE", stroke: "#FF00FF" },
};

/** SPC's label/fill/stroke properties, or the equivalent for a WPC ERO feature. */
function featureStyle(props: unknown): { label: string; detail: string; fill: string | null; stroke: string | null } {
  const dn = (props as Record<string, unknown> | null)?.dn;
  const ero = typeof dn === "number" && !prop(props, "LABEL") ? ERO_LEVELS[dn] : undefined;
  if (ero) return ero;
  return {
    label: prop(props, "LABEL") ?? "",
    detail: prop(props, "LABEL2") ?? "",
    fill: prop(props, "fill"),
    stroke: prop(props, "stroke"),
  };
}

/**
 * GeoJSON → map-ready features.
 *
 * Two passes, because hatching needs one reference latitude for the whole
 * product: the mean latitude of every hatched outer ring. Sharing it keeps all
 * slashes on one grid, so nested CIG areas read as one pattern.
 */
export function buildOutlook(product: OutlookProduct, json: unknown): OutlookData {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return { product, features: [] };

  const raws = features
    .map((f) => {
      const polys = geoPolygons((f as { geometry?: unknown })?.geometry).filter(
        (p) => p.length > 0 && p[0].length > 0,
      );
      const { label, detail, fill, stroke } = featureStyle((f as { properties?: unknown })?.properties);
      return { polys, label, detail, fill, stroke, hatched: detectHatched(label, detail) };
    })
    .filter((r) => r.polys.length > 0);

  let latSum = 0;
  let latCount = 0;
  for (const r of raws) {
    if (!r.hatched) continue;
    for (const poly of r.polys) {
      for (const [lat] of poly[0]) {
        latSum += lat;
        latCount++;
      }
    }
  }
  const refLat = latCount === 0 ? DEFAULT_REF_LAT : latSum / latCount;

  return {
    product,
    features: raws.map((r): OutlookFeature => {
      const fill = outlookColor(r.fill);
      const stroke = outlookColor(r.stroke);
      const digits = r.label.replace(/\D/g, "");
      return {
        rings: r.polys.map((p): Ring => p[0]),
        label: r.label,
        detail: r.detail,
        fillColor: toHex(outlookFillDark(fill)),
        strokeColor: r.hatched ? HATCH_COLOR : toHex(outlookStrokeDark(stroke)),
        fillColorLight: toHex(outlookFillLight(fill)),
        strokeColorLight: r.hatched ? HATCH_COLOR_LIGHT : toHex(outlookStrokeLight(stroke)),
        swatchColor: toHex(fill),
        isHatched: r.hatched,
        cigLevel: r.hatched && digits ? parseInt(digits, 10) : null,
        isGeneralThunderstorm: isGeneralThunderstorm(r.label, r.detail),
        hatch: r.hatched ? hatchSegments(r.polys, refLat) : [],
      };
    }),
  };
}
