import type { StormCategory } from "./types";

/**
 * The three kinds of storm report, and how each is shown.
 *
 * The hues of the mobile app's markers (red, royal blue, sea green), lifted
 * in brightness so they hold up on the dark basemap.
 */

export const CATEGORIES: readonly StormCategory[] = ["tornado", "wind", "hail"];

const META: Record<StormCategory, { name: string; glyph: string; color: string }> = {
  tornado: { name: "Tornado", glyph: "🌪️", color: "#FF3B30" },
  wind: { name: "Wind", glyph: "💨", color: "#4F7CFF" },
  hail: { name: "Hail", glyph: "🧊", color: "#34C77B" },
};

export function categoryName(category: StormCategory): string {
  return META[category].name;
}

export function categoryGlyph(category: StormCategory): string {
  return META[category].glyph;
}

export function categoryColor(category: StormCategory): string {
  return META[category].color;
}
