import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { exploreLayers, exploreSources } from "./explore-style";

const exploreStyle = (theme: "light" | "dark", part: "base" | "labels") => ({
  version: 8 as const,
  glyphs: "https://example.com/{fontstack}/{range}.pbf",
  sources: exploreSources(),
  layers: exploreLayers(theme, part),
});

describe("exploreStyle", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const part of ["base", "labels"] as const) {
      it(`is a valid MapLibre style (${theme} ${part})`, () => {
        expect(validateStyleMin(exploreStyle(theme, part))).toEqual([]);
      });
    }
  }

  it("draws terrain and land cover under the overlays, and only labels above them", () => {
    const types = (part: "base" | "labels") => new Set(exploreStyle("light", part).layers.map((l) => l.type));
    expect(types("base")).toContain("hillshade");
    expect(types("base")).not.toContain("symbol");
    expect([...types("labels")]).toEqual(["symbol"]);
  });

  it("fades its colors when muted, but keeps them where they are", () => {
    const fill = (muted: boolean) =>
      exploreLayers("light", "base", muted).find((l) => l.id === "wood")!.paint as Record<string, string>;
    expect(fill(true)["fill-color"]).not.toBe(fill(false)["fill-color"]);
    expect(exploreLayers("light", "base", true).map((l) => l.id)).toEqual(exploreLayers("light", "base").map((l) => l.id));
  });
});
