/**
 * Color parsing and adjustment, ported from `ColorUtil.cs` plus the dark-map
 * variants in the MAUI `MapPage`.
 *
 * SPC publishes a fill and stroke color per outlook area. Drawn as-is they
 * sit muddy on a dark basemap, so they are nudged toward blue (as every
 * DamageTracker client has done) and then saturated and brightened for dark.
 * On the light basemap they are saturated a little and outlined darker.
 */

export type Rgb = [r: number, g: number, b: number];

const GRAY: Rgb = [0.5, 0.5, 0.5];

/** "#RRGGBB" → components in 0..1, or null. */
export function rgbComponents(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const v = parseInt(s, 16);
  return [((v >> 16) & 0xff) / 255, ((v >> 8) & 0xff) / 255, (v & 0xff) / 255];
}

export function toHex([r, g, b]: Rgb): string {
  const part = (c: number) =>
    Math.round(Math.min(1, Math.max(0, c)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

/** An SPC color with its tone moved 22% toward blue. */
export function outlookColor(hex: string | null | undefined): Rgb {
  const c = rgbComponents(hex);
  if (!c) return GRAY;
  const t = 0.22;
  const target: Rgb = [0.2, 0.4, 1.0];
  return [
    c[0] * (1 - t) + target[0] * t,
    c[1] * (1 - t) + target[1] * t,
    c[2] * (1 - t) + target[2] * t,
  ];
}

/** Scale saturation and brightness (HSV) without changing the hue. */
export function adjusted(color: Rgb, saturationScale = 1, brightnessScale = 1): Rgb {
  const [h, s, v] = rgbToHsv(color);
  return hsvToRgb(h, clamp01(s * saturationScale), clamp01(v * brightnessScale));
}

/** Fill for an outlook area on the dark basemap (MAUI `OutlookFill`, dark). */
export function outlookFillDark(base: Rgb): Rgb {
  return adjusted(base, 2.1, 1.15);
}

/** Outline for an outlook area on the dark basemap (MAUI `OutlookStroke`, dark). */
export function outlookStrokeDark(base: Rgb): Rgb {
  return adjusted(base, 1.5, 1.45);
}

/** Fill for an outlook area on the light basemap. SPC's pastels, with a little more color. */
export function outlookFillLight(base: Rgb): Rgb {
  return adjusted(base, 1.35, 1);
}

/** Outline for an outlook area on the light basemap: darker, so it holds an edge on pale gray. */
export function outlookStrokeLight(base: Rgb): Rgb {
  return adjusted(base, 1.3, 0.75);
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function rgbToHsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max <= 0 ? 0 : delta / max;
  return [h, s, max];
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb: Rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [rgb[0] + m, rgb[1] + m, rgb[2] + m];
}
