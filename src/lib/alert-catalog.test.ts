import { describe, expect, it } from "vitest";
import { ALERT_GROUPS, eventInfo, eventLevel, UNKNOWN_PRIORITY } from "./alert-catalog";

describe("eventInfo", () => {
  it("knows the hazards Outside cares about most", () => {
    expect(eventInfo("Heat Advisory")).toMatchObject({ group: "heat", color: "#FF7F50" });
    expect(eventInfo("Coastal Flood Warning")).toMatchObject({ group: "coastal" });
    expect(eventInfo("Hurricane Warning")).toMatchObject({ group: "tropical", color: "#DC143C" });
    expect(eventInfo("Flash Flood Warning")).toMatchObject({ group: "flood" });
    expect(eventInfo("Small Craft Advisory")).toMatchObject({ group: "marine" });
  });

  it("keeps Outside's colors for the convective products", () => {
    expect(eventInfo("Tornado Warning").color).toBe("#FF0000");
    expect(eventInfo("Severe Thunderstorm Warning").color).toBe("#FFA500");
  });

  it("ranks by NWS priority", () => {
    const rank = (e: string) => eventInfo(e).priority;
    expect(rank("Tornado Warning")).toBeLessThan(rank("Hurricane Warning"));
    expect(rank("Hurricane Warning")).toBeLessThan(rank("Flood Warning"));
    expect(rank("Flood Warning")).toBeLessThan(rank("Heat Advisory"));
    expect(rank("Heat Advisory")).toBeLessThan(rank("Hazardous Weather Outlook"));
  });

  it("is case-insensitive, and guesses a family for events it doesn't list", () => {
    expect(eventInfo("heat advisory").group).toBe("heat");
    expect(eventInfo("Lakeshore Flood Something")).toMatchObject({ group: "coastal", priority: UNKNOWN_PRIORITY });
    expect(eventInfo("Brand New Snow Product").group).toBe("winter");
    expect(eventInfo("Volcanic Smog Advisory").group).toBe("other");
  });

  it("only uses known groups", () => {
    for (const e of ["Tornado Watch", "Red Flag Warning", "Dense Fog Advisory", "Mystery"]) {
      expect(ALERT_GROUPS).toContain(eventInfo(e).group);
    }
  });
});

describe("eventLevel", () => {
  it("reads the tier from the name", () => {
    expect(eventLevel("Extreme Heat Warning")).toBe("warning");
    expect(eventLevel("Flood Watch")).toBe("watch");
    expect(eventLevel("Coastal Flood Advisory")).toBe("advisory");
    expect(eventLevel("Air Quality Alert")).toBe("advisory");
    expect(eventLevel("Rip Current Statement")).toBe("statement");
    expect(eventLevel("Hazardous Weather Outlook")).toBe("statement");
  });
});
