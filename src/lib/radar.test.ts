import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import { parseRadarManifest } from "./radar";

describe("parseRadarManifest", () => {
  it("expands every frame into a tile template", () => {
    const m = parseRadarManifest(jsonFixture("rainviewer.json"))!;
    expect(m.past.length).toBeGreaterThan(5);
    expect(m.past[0].url).toMatch(
      /^https:\/\/tilecache\.rainviewer\.com\/v2\/radar\/[0-9a-f]+\/256\/\{z\}\/\{x\}\/\{y\}\/6\/1_1\.png$/,
    );
    expect(m.past[0].time).toBeGreaterThan(1_700_000_000);
    expect(m.attribution).toBe("RainViewer");
  });

  it("tolerates a missing or empty nowcast", () => {
    const m = parseRadarManifest({ host: "https://h", radar: { past: [{ time: 1, path: "/p" }] } })!;
    expect(m.nowcast).toEqual([]);
    expect(m.past[0].url).toBe("https://h/p/256/{z}/{x}/{y}/6/1_1.png");
  });

  it("returns null without a host or radar section", () => {
    expect(parseRadarManifest({ radar: {} })).toBeNull();
    expect(parseRadarManifest({ host: "https://h" })).toBeNull();
    expect(parseRadarManifest(null)).toBeNull();
  });
});
