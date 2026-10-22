import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { LayerSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import {
  buildStyle,
  fillLayer,
  keepOverlays,
  lineLayer,
  OVERLAY_PREFIX,
  SLOTS,
  slotEnd,
  slotMarker,
  type StyleOptions,
} from "./map-style";

const options = (patch: Partial<StyleOptions> = {}): StyleOptions => ({
  basemap: "gray",
  theme: "light",
  muted: false,
  terrain: false,
  ...patch,
});
const ids = (layers: LayerSpecification[]) => layers.map((l) => l.id);

describe("buildStyle", () => {
  for (const basemap of ["gray", "explore"] as const) {
    for (const theme of ["light", "dark"] as const) {
      it(`is a valid MapLibre style (${basemap}, ${theme})`, () => {
        expect(validateStyleMin(buildStyle(options({ basemap, theme, muted: true, terrain: true })))).toEqual([]);
      });
    }
  }

  it("has every slot, in order, with the basemap's labels in the labels slot", () => {
    for (const basemap of ["gray", "explore"] as const) {
      const layers = ids(buildStyle(options({ basemap })).layers);
      const markers = SLOTS.map((s) => layers.indexOf(slotMarker(s)));
      expect(markers.every((at, i) => at >= 0 && (i === 0 || at > markers[i - 1]))).toBe(true);
      const labelsAt = layers.indexOf(slotMarker("labels"));
      expect(layers[labelsAt + 1]).toMatch(basemap === "gray" ? "esri-labels" : /name|water|park|peak/);
    }
  });

  it("raises terrain only on the Explore map", () => {
    expect(buildStyle(options({ basemap: "explore", terrain: true })).terrain).toBeDefined();
    expect(buildStyle(options({ basemap: "gray", terrain: true })).terrain).toBeUndefined();
  });

  it("puts the last slot's overlays on top", () => {
    expect(slotEnd("alerts")).toBe(slotMarker("perimeters"));
    expect(slotEnd("you")).toBeUndefined();
  });
});

describe("keepOverlays", () => {
  it("carries overlays into a new basemap, each in its own slot", () => {
    const before = buildStyle(options({ basemap: "gray" }));
    const alerts: LayerSpecification = { id: `${OVERLAY_PREFIX}alerts:fill`, type: "fill", source: `${OVERLAY_PREFIX}alerts` };
    const reports: LayerSpecification = { id: `${OVERLAY_PREFIX}reports:dots`, type: "circle", source: `${OVERLAY_PREFIX}reports` };
    const insert = (layers: LayerSpecification[], layer: LayerSpecification, slot: (typeof SLOTS)[number]) => {
      const end = slotEnd(slot);
      const at = end ? layers.findIndex((l) => l.id === end) : layers.length;
      layers.splice(at, 0, layer);
    };
    insert(before.layers, alerts, "alerts");
    insert(before.layers, reports, "reports");
    before.sources[`${OVERLAY_PREFIX}alerts`] = { type: "geojson", data: { type: "FeatureCollection", features: [] } };

    const after = keepOverlays(before, buildStyle(options({ basemap: "explore" })));
    const layers = ids(after.layers);
    expect(layers.indexOf(alerts.id)).toBe(layers.indexOf(slotMarker("perimeters")) - 1);
    expect(layers.indexOf(reports.id)).toBe(layers.indexOf(slotMarker("you")) - 1);
    expect(after.sources).toHaveProperty(`${OVERLAY_PREFIX}alerts`);
    expect(after.sources).not.toHaveProperty("esri-base");
    expect(layers).not.toContain("esri-base");
  });
});

describe("overlay layers", () => {
  it("are valid with a source, dashed or not", () => {
    const style = buildStyle(options());
    style.sources.ov = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
    style.layers.push(
      { ...fillLayer, source: "ov" },
      { ...lineLayer(), source: "ov" },
      { ...lineLayer({ watch: [4, 3], statement: [2, 4] }, "dashed"), source: "ov" },
    );
    expect(validateStyleMin(style)).toEqual([]);
  });
});
