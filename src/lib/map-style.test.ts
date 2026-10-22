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
  theme: "light",
  muted: false,
  terrain: false,
  ...patch,
});
const ids = (layers: LayerSpecification[]) => layers.map((l) => l.id);

describe("buildStyle", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`is a valid MapLibre style (${theme})`, () => {
      expect(validateStyleMin(buildStyle(options({ theme })))).toEqual([]);
      expect(validateStyleMin(buildStyle(options({ theme, muted: true, terrain: true })))).toEqual([]);
    });
  }

  it("has every slot, in order, with the basemap's labels in the labels slot", () => {
    const layers = ids(buildStyle(options()).layers);
    const markers = SLOTS.map((s) => layers.indexOf(slotMarker(s)));
    expect(markers.every((at, i) => at >= 0 && (i === 0 || at > markers[i - 1]))).toBe(true);
    const labelsAt = layers.indexOf(slotMarker("labels"));
    expect(layers[labelsAt + 1]).toMatch(/name|water|park|peak/);
    expect(layers.indexOf("hillshade")).toBeLessThan(markers[0]);
  });

  it("raises terrain, with a sky, only when asked", () => {
    expect(buildStyle(options({ terrain: true }))).toMatchObject({ terrain: {}, sky: {} });
    expect(buildStyle(options()).terrain).toBeUndefined();
  });

  it("puts the last slot's overlays on top", () => {
    expect(slotEnd("alerts")).toBe(slotMarker("perimeters"));
    expect(slotEnd("you")).toBeUndefined();
  });
});

describe("keepOverlays", () => {
  it("carries overlays into a restyled map, each in its own slot", () => {
    const before = buildStyle(options({ theme: "light" }));
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

    const after = keepOverlays(before, buildStyle(options({ theme: "dark", terrain: true })));
    const layers = ids(after.layers);
    expect(layers.indexOf(alerts.id)).toBe(layers.indexOf(slotMarker("perimeters")) - 1);
    expect(layers.indexOf(reports.id)).toBe(layers.indexOf(slotMarker("you")) - 1);
    expect(after.sources).toHaveProperty(`${OVERLAY_PREFIX}alerts`);
    expect(after.terrain).toBeDefined();
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
