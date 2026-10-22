import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { describe, expect, it } from "vitest";
import { exploreStyle } from "./explore-style";

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

  it("credits its sources once, on the base", () => {
    expect(exploreStyle("light", "base").sources.omt).toHaveProperty("attribution");
    expect(exploreStyle("light", "labels").sources.omt).not.toHaveProperty("attribution");
  });
});
