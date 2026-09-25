import { describe, expect, it } from "vitest";
import { jsonFixture } from "./__fixtures__/load";
import { nominatimUrl, normalizeQuery, parseNominatim } from "./geocode";

describe("normalizeQuery", () => {
  it("collapses whitespace and case so equal searches share a cache entry", () => {
    expect(normalizeQuery("  Moore,   OK ")).toBe("moore, ok");
  });

  it("rejects empty, tiny, huge and non-string input", () => {
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("a")).toBeNull();
    expect(normalizeQuery("x".repeat(500))).toBeNull();
    expect(normalizeQuery(42)).toBeNull();
  });
});

describe("nominatimUrl", () => {
  it("limits to the US and asks for address details", () => {
    const url = new URL(nominatimUrl("moore, ok"));
    expect(url.searchParams.get("countrycodes")).toBe("us");
    expect(url.searchParams.get("addressdetails")).toBe("1");
    expect(url.searchParams.get("q")).toBe("moore, ok");
  });
});

describe("parseNominatim", () => {
  it("shortens names and reads coordinates", () => {
    const [first] = parseNominatim(jsonFixture("nominatim.json"));
    expect(first.name).toBe("Moore, Oklahoma");
    expect(first.lat).toBeCloseTo(35.338, 2);
    expect(first.lon).toBeCloseTo(-97.487, 2);
    expect(first.detail).toContain("Cleveland County");
  });

  it("uses the street for an address", () => {
    const [r] = parseNominatim([
      {
        lat: "35.3",
        lon: "-97.4",
        display_name: "123, Main Street, Moore, Oklahoma, United States",
        address: { house_number: "123", road: "Main Street", city: "Moore", state: "Oklahoma" },
      },
    ]);
    expect(r.name).toBe("123 Main Street, Moore, Oklahoma");
  });

  it("skips results without coordinates", () => {
    expect(parseNominatim([{ display_name: "x" }])).toEqual([]);
    expect(parseNominatim("nope")).toEqual([]);
  });
});
