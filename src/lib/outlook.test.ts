import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import {
  HATCH_COLOR,
  availableDays,
  buildOutlook,
  clampDay,
  detectHatched,
  isGeneralThunderstorm,
  outlookProduct,
} from "./outlook";

describe("outlookProduct", () => {
  it("names the product and its URLs", () => {
    expect(outlookProduct(2, "tornado")).toEqual({
      day: 2,
      kind: "tornado",
      id: "day2_torn",
      title: "Day 2 Tornado",
      url: "https://www.spc.noaa.gov/products/outlook/day2otlk_torn.nolyr.geojson",
      discussionUrl: "https://www.spc.noaa.gov/products/outlook/day2otlk.html",
    });
    expect(outlookProduct(1, "categorical").id).toBe("day1_cat");
  });

  it("knows which days each kind publishes", () => {
    expect(availableDays("categorical")).toEqual([1, 2, 3]);
    expect(availableDays("hail")).toEqual([1, 2]);
    expect(clampDay("hail", 3)).toBe(1);
    expect(clampDay("categorical", 3)).toBe(3);
  });
});

describe("feature classification", () => {
  it("detects conditional-intensity hatching by label or detail", () => {
    expect(detectHatched("CIG2", "")).toBe(true);
    expect(detectHatched("SIGN", "Tornado Conditional Intensity Group 1 Risk")).toBe(true);
    expect(detectHatched("0.05", "5% Tornado Risk")).toBe(false);
  });

  it("detects general thunderstorms", () => {
    expect(isGeneralThunderstorm("TSTM", "")).toBe(true);
    expect(isGeneralThunderstorm("X", "General Thunderstorms Risk")).toBe(true);
    expect(isGeneralThunderstorm("SLGT", "Slight Risk")).toBe(false);
  });
});

describe("buildOutlook", () => {
  it("builds categorical areas with dark-map colors and no hatching", () => {
    const { product, features } = buildOutlook(
      outlookProduct(1, "categorical"),
      jsonFixture("outlook-cat.geojson"),
    );
    expect(product.id).toBe("day1_cat");
    expect(features.map((f) => f.label)).toEqual(["TSTM", "MRGL", "SLGT", "ENH"]);
    expect(features[0].isGeneralThunderstorm).toBe(true);
    for (const f of features) {
      expect(f.isHatched).toBe(false);
      expect(f.hatch).toEqual([]);
      expect(f.fillColor).toMatch(/^#[0-9A-F]{6}$/);
      expect(f.rings.length).toBeGreaterThan(0);
      // [lat, lon], not GeoJSON's [lon, lat].
      expect(f.rings[0][0][0]).toBeGreaterThan(20);
      expect(f.rings[0][0][1]).toBeLessThan(-60);
    }
  });

  it("hatches the CIG area and gives it a pale outline", () => {
    const { features } = buildOutlook(outlookProduct(1, "tornado"), jsonFixture("outlook-torn.geojson"));
    const cig = features.find((f) => f.label === "CIG1")!;
    expect(cig.isHatched).toBe(true);
    expect(cig.cigLevel).toBe(1);
    expect(cig.hatch.length).toBeGreaterThan(10);
    expect(cig.strokeColor).toBe(HATCH_COLOR);
    expect(features.filter((f) => f.isHatched)).toHaveLength(1);
  });

  it("returns no features for an empty collection or garbage", () => {
    const product = outlookProduct(1, "tornado");
    expect(
      buildOutlook(product, {
        features: [
          { geometry: { type: "GeometryCollection", geometries: [] }, properties: { LABEL: "x" } },
        ],
      }).features,
    ).toEqual([]);
    expect(buildOutlook(product, null).features).toEqual([]);
  });
});
