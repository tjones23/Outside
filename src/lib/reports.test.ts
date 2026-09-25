import { describe, expect, it } from "vitest";
import { fixture } from "./__fixtures__/load";
import { convectiveDate, dayLabel, formatMagnitude, parseSpcCsv, reportsUrl } from "./reports";

const csv = fixture("spc-reports.csv");
const reports = parseSpcCsv(csv, "2026-04-28");

describe("parseSpcCsv", () => {
  it("reads all three tables and skips rows without coordinates", () => {
    const count = (c: string) => reports.filter((r) => r.category === c).length;
    expect(count("tornado")).toBe(5);
    expect(count("wind")).toBe(5); // the missing-latitude row is dropped
    expect(count("hail")).toBe(4); // the exact duplicate row is dropped
  });

  it("converts hail from hundredths of an inch", () => {
    const hail = reports.find((r) => r.location === "1 N Kansas")!;
    expect(hail.magnitude).toBe("1.75");
    expect(hail.hailInches).toBe(1.75);
    expect(hail.title).toBe("Hail 1.75 in");
  });

  it("reads wind speed, and treats UNK as unknown", () => {
    expect(reports.find((r) => r.location === "Norman")!).toMatchObject({
      windMph: 65,
      title: "Wind 65 mph",
    });
    expect(reports.find((r) => r.location === "Davis")!).toMatchObject({
      windMph: null,
      title: "Wind damage",
    });
  });

  it("reads EF ratings", () => {
    const ef2 = reports.find((r) => r.location === "3 N Tuttle")!;
    expect(ef2.efRating).toBe(2);
    expect(ef2.title).toBe("Tornado (EF2)");
    expect(reports.find((r) => r.location === "Vashti")!).toMatchObject({
      efRating: null,
      title: "Tornado",
    });
  });

  it("keeps commas inside comments and strips CRLF", () => {
    const ef2 = reports.find((r) => r.location === "3 N Tuttle")!;
    expect(ef2.comments).toBe("Damage to barns, outbuildings, and trees. (OUN)");
    expect(reports.every((r) => !r.comments.endsWith("\r"))).toBe(true);
  });

  it("builds the subtitle and coordinates", () => {
    const r = reports.find((x) => x.location === "Leon")!;
    expect(r.subtitle).toBe("Leon, Love Co, OK");
    expect(r.coord).toEqual([33.88, -97.43]);
    expect(r.date).toBe("2026-04-28");
  });

  it("gives the same row the same id on every parse", () => {
    const again = parseSpcCsv(csv, "2026-04-28");
    expect(again.map((r) => r.id)).toEqual(reports.map((r) => r.id));
    expect(new Set(reports.map((r) => r.id)).size).toBe(reports.length);
  });

  it("gives the same row a different id on a different day", () => {
    expect(parseSpcCsv(csv, "2026-04-29")[0].id).not.toBe(reports[0].id);
  });

  it("returns nothing for text that isn't a report file", () => {
    expect(parseSpcCsv("<html>404</html>", "2026-04-28")).toEqual([]);
  });
});

describe("formatMagnitude", () => {
  it("leaves non-hail and unparseable hail alone", () => {
    expect(formatMagnitude(" EF1 ", "tornado")).toBe("EF1");
    expect(formatMagnitude("UNK", "hail")).toBe("UNK");
    expect(formatMagnitude("100", "hail")).toBe("1.00");
  });
});

describe("convective days", () => {
  it("rolls over at 12Z, not midnight", () => {
    expect(convectiveDate(new Date("2026-05-20T11:59:00Z"))).toBe("2026-05-19");
    expect(convectiveDate(new Date("2026-05-20T12:00:00Z"))).toBe("2026-05-20");
  });

  it("counts back whole days", () => {
    const now = new Date("2026-05-20T18:00:00Z");
    expect(convectiveDate(now, 1)).toBe("2026-05-19");
    expect(convectiveDate(now, 4)).toBe("2026-05-16");
  });

  it("never gives 'yesterday' the same day as 'today' overnight", () => {
    // 1 AM Central: the calendar day has turned in Chicago, but SPC's hasn't.
    const now = new Date("2026-05-20T06:00:00Z");
    expect(convectiveDate(now, 0)).toBe("2026-05-19");
    expect(convectiveDate(now, 1)).toBe("2026-05-18");
  });

  it("crosses month and year boundaries", () => {
    expect(convectiveDate(new Date("2026-01-01T13:00:00Z"), 1)).toBe("2025-12-31");
  });

  it("names the right file", () => {
    expect(reportsUrl("2026-05-19", true)).toBe("https://www.spc.noaa.gov/climo/reports/today.csv");
    expect(reportsUrl("2026-05-09", false)).toBe(
      "https://www.spc.noaa.gov/climo/reports/260509_rpts.csv",
    );
  });

  it("labels days relative to the current convective day", () => {
    const now = new Date("2026-05-20T18:00:00Z");
    expect(dayLabel("2026-05-20", now)).toBe("Today");
    expect(dayLabel("2026-05-19", now)).toBe("Yesterday");
    expect(dayLabel("2026-05-17", now)).toBe("May 17");
  });
});
