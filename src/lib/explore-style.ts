import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  RasterDEMSourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import { adjusted, rgbComponents, toHex } from "./color";
import type { Theme } from "./theme";

/**
 * The basemap ("Explore"): a vector map in the spirit of Apple Maps' Explore
 * mode — soft land cover, blue water, white roads and terrain shading —
 * drawn by MapLibre GL.
 *
 * Everything here is free and keyless, like the rest of Outside:
 * - streets, land cover and labels: OpenFreeMap's OpenMapTiles-schema tiles
 *   (OpenStreetMap data);
 * - terrain: the Terrain Tiles on AWS Open Data (Mapzen's terrarium DEM).
 *
 * The layers come in two parts: the base under radar and warnings, and the
 * labels above them.
 * `map-style.ts` puts them in place around the overlays.
 */

export type ExplorePart = "base" | "labels";

const OPENFREEMAP = "https://tiles.openfreemap.org";
const TERRAIN = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

/** Hosts MapLibre fetches from (connect-src: it loads tiles with `fetch`). */
export const EXPLORE_HOSTS = [OPENFREEMAP, "https://s3.amazonaws.com"] as const;

const OPENFREEMAP_ATTRIBUTION =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TERRAIN_ATTRIBUTION = 'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/">Mapzen, AWS Open Data</a>';

interface Palette {
  land: string;
  residential: string;
  grass: string;
  wood: string;
  park: string;
  farmland: string;
  sand: string;
  ice: string;
  wetland: string;
  rock: string;
  water: string;
  building: string;
  runway: string;
  road: string;
  roadCasing: string;
  motorway: string;
  motorwayCasing: string;
  path: string;
  rail: string;
  shadow: string;
  highlight: string;
  label: string;
  labelMinor: string;
  labelHalo: string;
  waterLabel: string;
  parkLabel: string;
}

/** Light is Apple's daytime Explore palette, by eye; dark is its night map. */
const PALETTE: Record<Theme, Palette> = {
  light: {
    land: "#F3F2EE",
    residential: "#ECEAE5",
    grass: "#DCEBCB",
    wood: "#C9E2B4",
    park: "#C4E5B0",
    farmland: "#EEF1E6",
    sand: "#F3EBD5",
    ice: "#FFFFFF",
    wetland: "#D3E7D3",
    rock: "#E6E3DD",
    water: "#9FD3F6",
    building: "#E3E0DA",
    runway: "#E2E2E6",
    road: "#FFFFFF",
    roadCasing: "#D9D5CC",
    motorway: "#FFF4C7",
    motorwayCasing: "#E5CF85",
    path: "#D3CDBF",
    rail: "#C9C5BD",
    shadow: "rgba(70, 82, 95, 0.55)",
    highlight: "rgba(255, 255, 255, 0.45)",
    label: "#33333A",
    labelMinor: "#5C5C66",
    labelHalo: "rgba(255, 255, 255, 0.9)",
    waterLabel: "#3B7DBA",
    parkLabel: "#3F7A35",
  },
  dark: {
    land: "#26272B",
    residential: "#2B2C31",
    grass: "#27332B",
    wood: "#25352A",
    park: "#26392B",
    farmland: "#2A2E2A",
    sand: "#34322C",
    ice: "#3A3D44",
    wetland: "#26332F",
    rock: "#2E2F33",
    water: "#1C3048",
    building: "#323339",
    runway: "#3A3B40",
    road: "#4B4C53",
    roadCasing: "#1E1F22",
    motorway: "#6B6250",
    motorwayCasing: "#2A271F",
    path: "#45464C",
    rail: "#45464C",
    shadow: "rgba(0, 0, 0, 0.6)",
    highlight: "rgba(255, 255, 255, 0.08)",
    label: "#E8E8ED",
    labelMinor: "#AEAEB8",
    labelHalo: "rgba(20, 20, 24, 0.9)",
    waterLabel: "#7FB4E6",
    parkLabel: "#8CC48A",
  },
};

const NAME: ExpressionSpecification = ["coalesce", ["get", "name:en"], ["get", "name"]];
const REGULAR = ["Noto Sans Regular"];
const BOLD = ["Noto Sans Bold"];
const ITALIC = ["Noto Sans Italic"];

/** Road width in pixels by zoom: `[zoom, width]` pairs, interpolated exponentially. */
function width(...stops: [number, number][]): ExpressionSpecification {
  return ["interpolate", ["exponential", 1.4], ["zoom"], ...stops.flat()] as ExpressionSpecification;
}

const ROAD_CLASSES = {
  motorway: ["motorway", "trunk"],
  major: ["primary", "secondary"],
  minor: ["tertiary", "minor", "service"],
};

function baseLayers(c: Palette): LayerSpecification[] {
  const fill = (id: string, layer: string, filter: FilterSpecification, color: string, minzoom = 0): LayerSpecification => ({
    id,
    type: "fill",
    source: "omt",
    "source-layer": layer,
    minzoom,
    filter,
    paint: { "fill-color": color, "fill-antialias": false },
  });
  const road = (id: string, classes: string[], color: string, w: ExpressionSpecification, minzoom: number) =>
    ({
      id,
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom,
      filter: ["all", ["in", ["get", "class"], ["literal", classes]], ["!=", ["get", "brunnel"], "tunnel"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color, "line-width": w },
    }) satisfies LayerSpecification;

  return [
    { id: "land", type: "background", paint: { "background-color": c.land } },
    fill("residential", "landuse", ["in", ["get", "class"], ["literal", ["residential", "suburb", "neighbourhood"]]], c.residential, 10),
    fill("farmland", "landcover", ["==", ["get", "class"], "farmland"], c.farmland),
    fill("grass", "landcover", ["==", ["get", "class"], "grass"], c.grass),
    fill("wood", "landcover", ["==", ["get", "class"], "wood"], c.wood),
    fill("wetland", "landcover", ["==", ["get", "class"], "wetland"], c.wetland),
    fill("sand", "landcover", ["==", ["get", "class"], "sand"], c.sand),
    fill("rock", "landcover", ["==", ["get", "class"], "rock"], c.rock),
    fill("ice", "landcover", ["==", ["get", "class"], "ice"], c.ice),
    fill("park", "park", ["==", ["geometry-type"], "Polygon"], c.park),
    fill("green-landuse", "landuse", ["in", ["get", "class"], ["literal", ["cemetery", "pitch", "playground", "garden"]]], c.park, 12),
    {
      id: "hillshade",
      type: "hillshade",
      source: "terrain",
      paint: {
        "hillshade-method": "igor",
        "hillshade-exaggeration": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 8, 0.6, 13, 0.4],
        "hillshade-shadow-color": c.shadow,
        "hillshade-highlight-color": c.highlight,
        "hillshade-accent-color": "rgba(0, 0, 0, 0)",
      },
    },
    fill("water", "water", ["!=", ["get", "brunnel"], "tunnel"], c.water),
    {
      id: "waterway",
      type: "line",
      source: "omt",
      "source-layer": "waterway",
      minzoom: 8,
      filter: ["!=", ["get", "brunnel"], "tunnel"],
      layout: { "line-cap": "round" },
      paint: { "line-color": c.water, "line-width": width([8, 0.5], [14, 2], [18, 6]) },
    },
    {
      id: "runway",
      type: "line",
      source: "omt",
      "source-layer": "aeroway",
      minzoom: 10,
      filter: ["in", ["get", "class"], ["literal", ["runway", "taxiway"]]],
      paint: { "line-color": c.runway, "line-width": width([10, 1], [14, 8], [18, 40]) },
    },
    {
      id: "building",
      type: "fill",
      source: "omt",
      "source-layer": "building",
      minzoom: 14,
      paint: { "fill-color": c.building, "fill-outline-color": c.roadCasing },
    },
    {
      id: "path",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 13,
      filter: ["in", ["get", "class"], ["literal", ["path", "track"]]],
      paint: { "line-color": c.path, "line-width": width([13, 0.5], [18, 2]), "line-dasharray": [2, 1.5] },
    },
    {
      id: "rail",
      type: "line",
      source: "omt",
      "source-layer": "transportation",
      minzoom: 10,
      filter: ["==", ["get", "class"], "rail"],
      paint: { "line-color": c.rail, "line-width": width([10, 0.5], [18, 2.5]) },
    },
    // Casings first, then fills, so crossings join cleanly.
    road("minor-casing", ROAD_CLASSES.minor, c.roadCasing, width([12, 1], [14, 3], [18, 18]), 12),
    road("major-casing", ROAD_CLASSES.major, c.roadCasing, width([7, 0.75], [10, 2.5], [14, 6], [18, 28]), 7),
    road("motorway-casing", ROAD_CLASSES.motorway, c.motorwayCasing, width([5, 0.75], [10, 3], [14, 8], [18, 34]), 5),
    road("minor", ROAD_CLASSES.minor, c.road, width([12, 0.5], [14, 2], [18, 15]), 12),
    road("major", ROAD_CLASSES.major, c.road, width([7, 0.5], [10, 1.5], [14, 4.5], [18, 24]), 7),
    road("motorway", ROAD_CLASSES.motorway, c.motorway, width([5, 0.5], [10, 2], [14, 6], [18, 30]), 5),
  ];
}

function labelLayers(c: Palette): LayerSpecification[] {
  const halo = { "text-halo-color": c.labelHalo, "text-halo-width": 1.4, "text-halo-blur": 0.5 };
  const place = (
    id: string,
    classes: string[],
    font: string[],
    size: ExpressionSpecification,
    color: string,
    minzoom: number,
    maxzoom = 24,
  ): LayerSpecification => ({
    id,
    type: "symbol",
    source: "omt",
    "source-layer": "place",
    minzoom,
    maxzoom,
    filter: ["in", ["get", "class"], ["literal", classes]],
    layout: {
      "text-field": NAME,
      "text-font": font,
      "text-size": size,
      "text-max-width": 8,
      "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
    },
    paint: { "text-color": color, ...halo },
  });

  return [
    ...(["Point", "LineString"] as const).map(
      (geometry): LayerSpecification => ({
        id: `water-name-${geometry}`,
        type: "symbol",
        source: "omt",
        "source-layer": "water_name",
        filter: ["==", ["geometry-type"], geometry],
        layout: {
          "text-field": NAME,
          "text-font": ITALIC,
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 11, 10, 14],
          "text-letter-spacing": 0.1,
          "text-max-width": 6,
          // Lakes and seas are points; rivers and channels follow their line.
          "symbol-placement": geometry === "Point" ? "point" : "line",
        },
        paint: { "text-color": c.waterLabel, ...halo },
      }),
    ),
    {
      id: "park-name",
      type: "symbol",
      source: "omt",
      "source-layer": "park",
      minzoom: 8,
      filter: ["==", ["geometry-type"], "Point"],
      layout: {
        "text-field": NAME,
        "text-font": ITALIC,
        "text-size": 11,
        "text-max-width": 7,
        "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
      },
      paint: { "text-color": c.parkLabel, ...halo },
    },
    {
      id: "peak",
      type: "symbol",
      source: "omt",
      "source-layer": "mountain_peak",
      minzoom: 10,
      filter: ["==", ["get", "class"], "peak"],
      layout: {
        "text-field": ["format", "▲ ", {}, NAME, {}],
        "text-font": REGULAR,
        "text-size": 10.5,
        "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
      },
      paint: { "text-color": c.labelMinor, ...halo },
    },
    {
      id: "road-name",
      type: "symbol",
      source: "omt",
      "source-layer": "transportation_name",
      minzoom: 12,
      filter: ["in", ["get", "class"], ["literal", [...ROAD_CLASSES.motorway, ...ROAD_CLASSES.major, ...ROAD_CLASSES.minor]]],
      layout: {
        "text-field": NAME,
        "text-font": REGULAR,
        "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13],
        "symbol-placement": "line",
        "text-rotation-alignment": "map",
      },
      paint: { "text-color": c.labelMinor, ...halo },
    },
    place("village", ["village", "hamlet", "suburb", "neighbourhood"], REGULAR, ["interpolate", ["linear"], ["zoom"], 10, 10.5, 14, 13], c.labelMinor, 10),
    place("town", ["town"], REGULAR, ["interpolate", ["linear"], ["zoom"], 7, 11, 12, 15], c.label, 7),
    place("city", ["city"], BOLD, ["interpolate", ["linear"], ["zoom"], 4, 11, 8, 14, 12, 19], c.label, 4),
    place("state", ["state", "province"], BOLD, ["interpolate", ["linear"], ["zoom"], 3, 9, 6, 12], c.labelMinor, 3, 7),
    place("country", ["country"], BOLD, ["interpolate", ["linear"], ["zoom"], 2, 11, 5, 15], c.label, 1, 6),
  ];
}

/** While radar or a forecast plays, the base's colors fade so forest and water don't read as precipitation. */
const MUTED_SATURATION = 0.35;

function mutedPalette(c: Palette): Palette {
  const mute = (color: string) => {
    const rgb = rgbComponents(color);
    return rgb ? toHex(adjusted(rgb, MUTED_SATURATION)) : color;
  };
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, mute(v)])) as unknown as Palette;
}

export const EXPLORE_GLYPHS = `${OPENFREEMAP}/fonts/{fontstack}/{range}.pbf`;

/**
 * The Explore map's sources. `terrain3d` is a second copy of the terrain for
 * MapLibre's 3D mode: it asks for its own source, apart from the hillshade's.
 */
export function exploreSources(): StyleSpecification["sources"] {
  const terrain: RasterDEMSourceSpecification = {
    type: "raster-dem",
    tiles: [TERRAIN],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
  };
  return {
    omt: { type: "vector", url: `${OPENFREEMAP}/planet`, attribution: OPENFREEMAP_ATTRIBUTION },
    terrain: { ...terrain, attribution: TERRAIN_ATTRIBUTION },
    terrain3d: terrain,
  };
}

export const EXPLORE_TERRAIN_SOURCE = "terrain3d";

export function exploreLayers(theme: Theme, part: ExplorePart, muted = false): LayerSpecification[] {
  const c = muted ? mutedPalette(PALETTE[theme]) : PALETTE[theme];
  return part === "base" ? baseLayers(c) : labelLayers(c);
}
