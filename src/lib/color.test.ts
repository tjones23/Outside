import { describe, expect, it } from "vitest";
import { adjusted, outlookColor, outlookFillDark, outlookStrokeLight, rgbComponents, textOn, toHex } from "./color";

describe("rgbComponents", () => {
  it("parses hex with or without #", () => {
    expect(rgbComponents("#FF0000")).toEqual([1, 0, 0]);
    expect(rgbComponents("00ff00")).toEqual([0, 1, 0]);
  });

  it("rejects anything that isn't six hex digits", () => {
    expect(rgbComponents("#FFF")).toBeNull();
    expect(rgbComponents("#GGGGGG")).toBeNull();
    expect(rgbComponents(null)).toBeNull();
  });
});

describe("outlookColor", () => {
  it("moves the tone 22% toward blue", () => {
    const [r, g, b] = outlookColor("#FFFFFF");
    expect(r).toBeCloseTo(0.78 + 0.22 * 0.2);
    expect(g).toBeCloseTo(0.78 + 0.22 * 0.4);
    expect(b).toBeCloseTo(1);
  });

  it("falls back to gray", () => {
    expect(toHex(outlookColor("bogus"))).toBe("#808080");
  });
});

describe("adjusted", () => {
  it("keeps the hue while scaling saturation and brightness", () => {
    const base: [number, number, number] = [0.8, 0.4, 0.4];
    const out = adjusted(base, 1.5, 1.1);
    // Red stays the dominant channel and green/blue stay equal: same hue.
    expect(out[0]).toBeGreaterThan(out[1]);
    expect(out[1]).toBeCloseTo(out[2]);
  });

  it("clamps to the valid range", () => {
    const out = outlookFillDark([0.9, 0.9, 0.2]);
    for (const c of out) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });
});

describe("outlookStrokeLight", () => {
  it("darkens the outline for the light basemap", () => {
    const base: [number, number, number] = [0.9, 0.9, 0.5];
    expect(Math.max(...outlookStrokeLight(base))).toBeLessThan(Math.max(...base));
  });
});

describe("toHex", () => {
  it("round-trips", () => {
    expect(toHex(rgbComponents("#4169E1")!)).toBe("#4169E1");
  });
});

describe("textOn", () => {
  it("puts black on light alert colors and white on dark ones", () => {
    expect(textOn("#00FF00")).toBe("#000000"); // Flood Warning
    expect(textOn("#FFE4B5")).toBe("#000000"); // Special Weather Statement
    expect(textOn("#8B0000")).toBe("#FFFFFF"); // Flash Flood Warning
    expect(textOn("#0000FF")).toBe("#FFFFFF");
    expect(textOn("nonsense")).toBe("#FFFFFF");
  });
});
