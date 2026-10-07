import type { AlertGroup, AlertLevel } from "./types";

/**
 * Every NWS event Outside knows by name: its hazard family, its map color and
 * its rank.
 *
 * The order is NWS's own hazard-map priority (weather.gov/help-map), most
 * important first, so a Tornado Warning draws over a Heat Advisory and leads
 * any list it's in. Colors are NWS's, except the four convective products,
 * which keep the colors Outside (and DamageTracker) have always used.
 *
 * Events not listed here — NWS adds and renames them now and then — still
 * show: their family comes from keywords, their color is neutral gray and
 * they rank after everything listed.
 */

export const ALERT_GROUPS: readonly AlertGroup[] = [
  "severe",
  "tropical",
  "flood",
  "coastal",
  "heat",
  "winter",
  "wind",
  "fire",
  "marine",
  "other",
];

const GROUP_META: Record<AlertGroup, { name: string; glyph: string; color: string }> = {
  severe: { name: "Severe storms", glyph: "⛈️", color: "#FFA500" },
  tropical: { name: "Tropical", glyph: "🌀", color: "#DC143C" },
  flood: { name: "Flood", glyph: "🌊", color: "#00C853" },
  coastal: { name: "Coastal & surf", glyph: "🏖️", color: "#40E0D0" },
  heat: { name: "Heat", glyph: "🌡️", color: "#FF7F50" },
  winter: { name: "Winter & cold", glyph: "❄️", color: "#7B68EE" },
  wind: { name: "Wind & dust", glyph: "🌬️", color: "#DAA520" },
  fire: { name: "Fire weather", glyph: "🔥", color: "#FF1493" },
  marine: { name: "Marine", glyph: "⚓", color: "#D8BFD8" },
  other: { name: "Fog, air & other", glyph: "🌫️", color: "#A0A0A0" },
};

export function alertGroupName(group: AlertGroup): string {
  return GROUP_META[group].name;
}

export function alertGroupGlyph(group: AlertGroup): string {
  return GROUP_META[group].glyph;
}

export function alertGroupColor(group: AlertGroup): string {
  return GROUP_META[group].color;
}

/** [event, group, color], in NWS priority order. */
const CATALOG: [string, AlertGroup, string][] = [
  ["Tsunami Warning", "coastal", "#FD6347"],
  ["Tornado Warning", "severe", "#FF0000"],
  ["Extreme Wind Warning", "tropical", "#FF8C00"],
  ["Severe Thunderstorm Warning", "severe", "#FFA500"],
  ["Flash Flood Warning", "flood", "#8B0000"],
  ["Flash Flood Statement", "flood", "#8B0000"],
  ["Severe Weather Statement", "severe", "#00FFFF"],
  ["Shelter In Place Warning", "other", "#FA8072"],
  ["Evacuation Immediate", "other", "#7FFF00"],
  ["Civil Danger Warning", "other", "#FFB6C1"],
  ["Nuclear Power Plant Warning", "other", "#4B0082"],
  ["Radiological Hazard Warning", "other", "#4B0082"],
  ["Hazardous Materials Warning", "other", "#4B0082"],
  ["Fire Warning", "fire", "#A0522D"],
  ["Civil Emergency Message", "other", "#FFB6C1"],
  ["Law Enforcement Warning", "other", "#C0C0C0"],
  ["Storm Surge Warning", "tropical", "#B524F7"],
  ["Hurricane Force Wind Warning", "marine", "#CD5C5C"],
  ["Hurricane Warning", "tropical", "#DC143C"],
  ["Typhoon Warning", "tropical", "#DC143C"],
  ["Special Marine Warning", "marine", "#FFA500"],
  ["Blizzard Warning", "winter", "#FF4500"],
  ["Snow Squall Warning", "winter", "#C71585"],
  ["Ice Storm Warning", "winter", "#8B008B"],
  ["Heavy Freezing Spray Warning", "marine", "#00BFFF"],
  ["Winter Storm Warning", "winter", "#FF69B4"],
  ["Lake Effect Snow Warning", "winter", "#008B8B"],
  ["Dust Storm Warning", "wind", "#FFE4C4"],
  ["Blowing Dust Warning", "wind", "#FFE4C4"],
  ["High Wind Warning", "wind", "#DAA520"],
  ["Tropical Storm Warning", "tropical", "#B22222"],
  ["Storm Warning", "marine", "#9400D3"],
  ["Tsunami Advisory", "coastal", "#D2691E"],
  ["Tsunami Watch", "coastal", "#FF00FF"],
  ["Avalanche Warning", "winter", "#1E90FF"],
  ["Earthquake Warning", "other", "#8B4513"],
  ["Volcano Warning", "other", "#2F4F4F"],
  ["Ashfall Warning", "other", "#A9A9A9"],
  ["Flood Warning", "flood", "#00FF00"],
  ["Coastal Flood Warning", "coastal", "#228B22"],
  ["Lakeshore Flood Warning", "coastal", "#228B22"],
  ["Ashfall Advisory", "other", "#696969"],
  ["High Surf Warning", "coastal", "#228B22"],
  ["Extreme Heat Warning", "heat", "#C71585"],
  ["Excessive Heat Warning", "heat", "#C71585"],
  ["Tornado Watch", "severe", "#FF0000"],
  ["Severe Thunderstorm Watch", "severe", "#FFA500"],
  ["Flash Flood Watch", "flood", "#2E8B57"],
  ["Gale Warning", "marine", "#DDA0DD"],
  ["Flood Statement", "flood", "#00FF00"],
  ["Extreme Cold Warning", "winter", "#0000FF"],
  ["Wind Chill Warning", "winter", "#B0C4DE"],
  ["Hard Freeze Warning", "winter", "#9400D3"],
  ["Freeze Warning", "winter", "#483D8B"],
  ["Red Flag Warning", "fire", "#FF1493"],
  ["Storm Surge Watch", "tropical", "#DB7FF7"],
  ["Hurricane Watch", "tropical", "#FF00FF"],
  ["Hurricane Force Wind Watch", "marine", "#9932CC"],
  ["Typhoon Watch", "tropical", "#FF00FF"],
  ["Tropical Storm Watch", "tropical", "#F08080"],
  ["Storm Watch", "marine", "#FFE4B5"],
  ["Hurricane Local Statement", "tropical", "#FFE4B5"],
  ["Typhoon Local Statement", "tropical", "#FFE4B5"],
  ["Tropical Cyclone Local Statement", "tropical", "#FFE4B5"],
  ["Tropical Depression Local Statement", "tropical", "#FFE4B5"],
  ["Tropical Storm Local Statement", "tropical", "#FFE4B5"],
  ["Winter Weather Advisory", "winter", "#7B68EE"],
  ["Avalanche Advisory", "winter", "#CD853F"],
  ["Cold Weather Advisory", "winter", "#AFEEEE"],
  ["Wind Chill Advisory", "winter", "#AFEEEE"],
  ["Heat Advisory", "heat", "#FF7F50"],
  ["Urban and Small Stream Flood Advisory", "flood", "#00FF7F"],
  ["Small Stream Flood Advisory", "flood", "#00FF7F"],
  ["Arroyo and Small Stream Flood Advisory", "flood", "#00FF7F"],
  ["Flood Advisory", "flood", "#00FF7F"],
  ["Hydrologic Advisory", "flood", "#00FF7F"],
  ["Coastal Flood Advisory", "coastal", "#7CFC00"],
  ["Lakeshore Flood Advisory", "coastal", "#7CFC00"],
  ["High Surf Advisory", "coastal", "#BA55D3"],
  ["Dense Fog Advisory", "other", "#708090"],
  ["Dense Smoke Advisory", "other", "#F0E68C"],
  ["Small Craft Advisory", "marine", "#D8BFD8"],
  ["Small Craft Advisory For Hazardous Seas", "marine", "#D8BFD8"],
  ["Small Craft Advisory For Rough Bar", "marine", "#D8BFD8"],
  ["Small Craft Advisory For Winds", "marine", "#D8BFD8"],
  ["Brisk Wind Advisory", "marine", "#D8BFD8"],
  ["Hazardous Seas Warning", "marine", "#D8BFD8"],
  ["Dust Advisory", "wind", "#BDB76B"],
  ["Blowing Dust Advisory", "wind", "#BDB76B"],
  ["Lake Wind Advisory", "wind", "#D2B48C"],
  ["Wind Advisory", "wind", "#D2B48C"],
  ["Frost Advisory", "winter", "#6495ED"],
  ["Freezing Fog Advisory", "winter", "#008080"],
  ["Freezing Spray Advisory", "marine", "#00BFFF"],
  ["Low Water Advisory", "marine", "#A52A2A"],
  ["Local Area Emergency", "other", "#C0C0C0"],
  ["Winter Storm Watch", "winter", "#4682B4"],
  ["Rip Current Statement", "coastal", "#40E0D0"],
  ["Beach Hazards Statement", "coastal", "#40E0D0"],
  ["Gale Watch", "marine", "#FFC0CB"],
  ["Avalanche Watch", "winter", "#F4A460"],
  ["Hazardous Seas Watch", "marine", "#483D8B"],
  ["Heavy Freezing Spray Watch", "marine", "#BC8F8F"],
  ["Flood Watch", "flood", "#2E8B57"],
  ["Coastal Flood Watch", "coastal", "#66CDAA"],
  ["Lakeshore Flood Watch", "coastal", "#66CDAA"],
  ["High Wind Watch", "wind", "#B8860B"],
  ["Extreme Heat Watch", "heat", "#800000"],
  ["Excessive Heat Watch", "heat", "#800000"],
  ["Extreme Cold Watch", "winter", "#5F9EA0"],
  ["Wind Chill Watch", "winter", "#5F9EA0"],
  ["Hard Freeze Watch", "winter", "#4169E1"],
  ["Freeze Watch", "winter", "#00FFFF"],
  ["Fire Weather Watch", "fire", "#FFDEAD"],
  ["Extreme Fire Danger", "fire", "#E9967A"],
  ["911 Telephone Outage", "other", "#C0C0C0"],
  ["Coastal Flood Statement", "coastal", "#6B8E23"],
  ["Lakeshore Flood Statement", "coastal", "#6B8E23"],
  ["Special Weather Statement", "other", "#FFE4B5"],
  ["Marine Weather Statement", "marine", "#FFDAB9"],
  ["Air Quality Alert", "other", "#808080"],
  ["Air Stagnation Advisory", "other", "#808080"],
  ["Hazardous Weather Outlook", "other", "#EEE8AA"],
  ["Hydrologic Outlook", "flood", "#90EE90"],
  ["Short Term Forecast", "other", "#98FB98"],
  ["Administrative Message", "other", "#C0C0C0"],
  ["Child Abduction Emergency", "other", "#FFFFFF"],
  ["Blue Alert", "other", "#FFFFFF"],
];

const BY_EVENT = new Map(CATALOG.map(([event, group, color], i) => [event.toLowerCase(), { group, color, priority: i }]));

/** Unknown events rank after every known one. */
export const UNKNOWN_PRIORITY = CATALOG.length;
const UNKNOWN_COLOR = "#A0A0A0";

/** Keyword fallback for events the catalog doesn't list. */
function guessGroup(e: string): AlertGroup {
  if (/tornado|thunderstorm/.test(e)) return "severe";
  if (/hurricane|tropical|typhoon|surge/.test(e)) return "tropical";
  if (/coastal|lakeshore|surf|rip current|beach|tsunami/.test(e)) return "coastal";
  if (/flood|hydrologic/.test(e)) return "flood";
  if (/heat/.test(e)) return "heat";
  if (/snow|winter|ice|freez|frost|cold|chill|blizzard|avalanche/.test(e)) return "winter";
  if (/fire|red flag/.test(e)) return "fire";
  if (/marine|craft|gale|seas|spray/.test(e)) return "marine";
  if (/wind|dust/.test(e)) return "wind";
  return "other";
}

export interface EventInfo {
  group: AlertGroup;
  color: string;
  priority: number;
}

export function eventInfo(event: string): EventInfo {
  const e = event.trim().toLowerCase();
  return BY_EVENT.get(e) ?? { group: guessGroup(e), color: UNKNOWN_COLOR, priority: UNKNOWN_PRIORITY };
}

/** "…Warning" → warning, and so on. Statements, outlooks, alerts and messages are all "statement". */
export function eventLevel(event: string): AlertLevel {
  const e = event.toLowerCase();
  if (/\bwarning\b/.test(e)) return "warning";
  if (/\bwatch\b/.test(e)) return "watch";
  if (/\badvisory\b/.test(e)) return "advisory";
  // An Air Quality Alert is an advisory in all but name.
  if (/air quality alert/.test(e)) return "advisory";
  return "statement";
}

export const ALERT_LEVELS: readonly AlertLevel[] = ["warning", "watch", "advisory", "statement"];

export function alertLevelName(level: AlertLevel, plural = true): string {
  const names: Record<AlertLevel, [string, string]> = {
    warning: ["Warning", "Warnings"],
    watch: ["Watch", "Watches"],
    advisory: ["Advisory", "Advisories"],
    statement: ["Statement", "Statements"],
  };
  return names[level][plural ? 1 : 0];
}
