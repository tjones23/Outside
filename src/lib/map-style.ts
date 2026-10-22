import type {
  FillLayerSpecification,
  LayerSpecification,
  LineLayerSpecification,
  SkySpecification,
  StyleSpecification,
} from "maplibre-gl";
import { EXPLORE_GLYPHS, EXPLORE_TERRAIN_SOURCE, exploreLayers, exploreSources } from "./explore-style";
import type { Theme } from "./theme";
import type { Basemap } from "./types";

/**
 * The MapLibre style under Outside's map: a basemap, with slots between its
 * base and label layers where the storm data goes.
 *
 * Layer order, bottom to top. Each slot starts with an invisible marker
 * layer; an overlay goes in just before the next slot's marker, so a feed
 * that reloads can't jump above one that didn't. The basemap's labels sit in
 * the `labels` slot: above radar and warnings, below storm tracks, fires and
 * reports.
 */
export const SLOTS = [
  "imagery",
  "outlook",
  "smoke",
  "damage",
  "tropicalAreas",
  "alerts",
  "perimeters",
  "borders",
  "labels",
  "tropical",
  "air",
  "hotspots",
  "fires",
  "reports",
  "you",
] as const;

export type Slot = (typeof SLOTS)[number];

const MARKER_PREFIX = "slot:";

export function slotMarker(slot: Slot): string {
  return `${MARKER_PREFIX}${slot}`;
}

/** Where a slot's layers go: before the next slot's marker, or on top for the last. */
export function slotEnd(slot: Slot): string | undefined {
  const next = SLOTS[SLOTS.indexOf(slot) + 1];
  return next ? slotMarker(next) : undefined;
}

function markerLayer(slot: Slot): LayerSpecification {
  return { id: slotMarker(slot), type: "background", layout: { visibility: "none" } };
}

/** Overlay sources and layers carry this prefix, so a basemap swap keeps them. */
export const OVERLAY_PREFIX = "ov:";

/**
 * Esri's Dark Gray and Light Gray Canvas, one per theme: free and keyless
 * with attribution. (CARTO's tiles, the usual choice, now answer every
 * request with an "API key required" placeholder.) Base and labels are
 * separate services, so the labels can sit above radar and warning polygons.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ESRI_CANVAS = { dark: "World_Dark_Gray", light: "World_Light_Gray" } as const;
const ESRI_ATTRIBUTION =
  'Tiles &copy; <a href="https://www.esri.com/">Esri</a> &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
const ESRI_MAX_NATIVE_ZOOM = 16;

/** The page's `--map-ground`, shown before tiles arrive. */
const GROUND: Record<Theme, string> = { dark: "#0b0b10", light: "#e3e3e3" };

/** Behind tilted terrain, a sky that fades into haze at the horizon. */
const HAZE = { "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6 } as const;
const SKY: Record<Theme, SkySpecification> = {
  light: { "sky-color": "#9cc8ef", "horizon-color": "#e6eef5", "fog-color": "#f3f2ee", ...HAZE },
  dark: { "sky-color": "#0d1626", "horizon-color": "#1e2635", "fog-color": "#26272b", ...HAZE },
};

export interface StyleOptions {
  basemap: Basemap;
  theme: Theme;
  /** Radar or a forecast animation is on: fade the Explore map's colors. */
  muted: boolean;
  /** Explore only: raise the terrain in 3D (while the map is tilted). */
  terrain: boolean;
}

export function buildStyle({ basemap, theme, muted, terrain }: StyleOptions): StyleSpecification {
  const ground: LayerSpecification = { id: "ground", type: "background", paint: { "background-color": GROUND[theme] } };
  const esri = (part: "Base" | "Reference") =>
    `${ESRI}/${ESRI_CANVAS[theme]}_${part}/MapServer/tile/{z}/{y}/{x}`;

  const explore = basemap === "explore";
  const base: LayerSpecification[] = explore
    ? exploreLayers(theme, "base", muted)
    : [{ id: "esri-base", type: "raster", source: "esri-base" }];
  const labels: LayerSpecification[] = explore
    ? exploreLayers(theme, "labels")
    : [{ id: "esri-labels", type: "raster", source: "esri-labels" }];

  const layers: LayerSpecification[] = [ground, ...base];
  for (const slot of SLOTS) {
    layers.push(markerLayer(slot));
    if (slot === "labels") layers.push(...labels);
  }

  return {
    version: 8,
    // Kept on both basemaps, so swapping them never has to reload fonts.
    glyphs: EXPLORE_GLYPHS,
    sources: explore
      ? exploreSources()
      : {
          "esri-base": {
            type: "raster",
            tiles: [esri("Base")],
            tileSize: 256,
            maxzoom: ESRI_MAX_NATIVE_ZOOM,
            attribution: ESRI_ATTRIBUTION,
          },
          "esri-labels": { type: "raster", tiles: [esri("Reference")], tileSize: 256, maxzoom: ESRI_MAX_NATIVE_ZOOM },
        },
    layers,
    ...(explore && terrain
      ? { terrain: { source: EXPLORE_TERRAIN_SOURCE, exaggeration: 1.3 }, sky: SKY[theme] }
      : {}),
  };
}

/**
 * A new basemap style with the current overlays carried over: their sources,
 * and their layers in the same slots. For `map.setStyle`'s `transformStyle`.
 */
export function keepOverlays(previous: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!previous) return next;
  const sources = { ...next.sources };
  for (const [id, source] of Object.entries(previous.sources)) {
    if (id.startsWith(OVERLAY_PREFIX)) sources[id] = source;
  }

  // Each slot's overlays, in order, from the previous style.
  const bySlot = new Map<string, LayerSpecification[]>();
  let slot: string | null = null;
  for (const layer of previous.layers) {
    if (layer.id.startsWith(MARKER_PREFIX)) slot = layer.id;
    else if (slot && layer.id.startsWith(OVERLAY_PREFIX)) bySlot.set(slot, [...(bySlot.get(slot) ?? []), layer]);
  }

  // Into the new style: each slot's overlays go at the end of that slot.
  const layers: LayerSpecification[] = [];
  slot = null;
  for (const layer of next.layers) {
    if (layer.id.startsWith(MARKER_PREFIX)) {
      if (slot) layers.push(...(bySlot.get(slot) ?? []));
      slot = layer.id;
    }
    layers.push(layer);
  }
  if (slot) layers.push(...(bySlot.get(slot) ?? []));
  return { ...next, sources, layers };
}

/** A layer for an overlay, which supplies the source. */
export type Unsourced<L> = Omit<L, "source" | "source-layer">;

/**
 * The usual shape layers, styled by each feature's properties: `fill` and
 * `fo` (fill opacity); `stroke`, `so` (its opacity) and `w` (its width in
 * pixels); and `dash`, a name looked up in `dashes` — MapLibre can't take a
 * dash array from a GeoJSON property, so each overlay names its patterns.
 * Dash lengths are in line widths.
 */
export const fillLayer: Unsourced<FillLayerSpecification> = {
  id: "fill",
  type: "fill",
  paint: { "fill-color": ["get", "fill"], "fill-opacity": ["get", "fo"] },
};

export function lineLayer(dashes: Record<string, number[]> = {}, id = "line"): Unsourced<LineLayerSpecification> {
  const names = Object.entries(dashes);
  return {
    id,
    type: "line",
    layout: { "line-join": "round" },
    paint: {
      "line-color": ["get", "stroke"],
      "line-opacity": ["coalesce", ["get", "so"], 1],
      "line-width": ["get", "w"],
      ...(names.length > 0
        ? {
            "line-dasharray": [
              "match",
              ["coalesce", ["get", "dash"], ""],
              ...names.flatMap(([name, pattern]) => [name, ["literal", pattern]]),
              ["literal", [1, 0]],
            ],
          }
        : {}),
    },
  } as Unsourced<LineLayerSpecification>;
}
