import type { Map as GLMap } from "maplibre-gl";
import { aqiCategory } from "@/lib/air-quality";
import { CONTAINMENT_BANDS, type ContainmentBand } from "@/lib/wildfire";

/**
 * Icons the map draws itself: a flame per containment band, and an AQI dot
 * per value. They're painted onto a canvas the first time a layer asks for
 * one (MapLibre's missing-image resolver), which also brings them back after
 * a restyle (theme, tilt) clears the style's images.
 */

/**
 * A flame in the shape of 🔥 — an emoji can't be recolored, so it's drawn:
 * the outer flame takes the containment color, the inner one a lighter tint
 * of it. Drawn on a 24-unit square, its base at the bottom center.
 */
export const FLAME_OUTER =
  "M12 1.5C12.6 5 15.5 6.8 17.3 9.6C18.6 11.6 19.2 13.4 19.2 15.2C19.2 19.4 16 22.5 12 22.5C8 22.5 4.8 19.4 4.8 15.4C4.8 12.9 6 10.9 7.4 9.4C7.5 11 8.2 12.3 9.3 13C9 9.2 10.4 5.2 12 1.5Z";
export const FLAME_INNER =
  "M12 12.2C12.4 14.2 14.6 15.4 14.6 17.8C14.6 19.4 13.4 20.6 12 20.6C10.6 20.6 9.4 19.4 9.4 17.9C9.4 16.2 10.6 15.1 11.2 13.6C11.5 13.1 11.8 12.6 12 12.2Z";
export const FLAME_STROKE = "rgb(0 0 0 / 0.7)";

/** The flame's box in the icon, in CSS pixels, and the margin left for its glow. */
export const FLAME_BOX = 32;
const FLAME_MARGIN = 5;
/**
 * The icon is centered on its point; this moves it up so the flame's base
 * (94% of the way down its box) stands on the point instead.
 */
export const FLAME_OFFSET: [number, number] = [0, -Math.round(FLAME_BOX * (0.94 - 0.5))];

export const flameIcon = (band: ContainmentBand) => `flame:${band}`;
export const aqiIcon = (aqi: number) => `aqi:${aqi}`;

const AQI_DOT = 22;
const AQI_MARGIN = 3;

function canvas(size: number, ratio: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const el = document.createElement("canvas");
  el.width = el.height = Math.ceil(size * ratio);
  const ctx = el.getContext("2d")!;
  ctx.scale(ratio, ratio);
  return [el, ctx];
}

function drawFlame(band: ContainmentBand, ratio: number) {
  const color = CONTAINMENT_BANDS.find((b) => b.band === band)!.color;
  const size = FLAME_BOX + FLAME_MARGIN * 2;
  const [el, ctx] = canvas(size, ratio);
  const scale = FLAME_BOX / 24;
  ctx.translate(FLAME_MARGIN, FLAME_MARGIN);
  ctx.scale(scale, scale);
  const outer = new Path2D(FLAME_OUTER);

  // Fires under half contained glow, so the ones still running stand out.
  // (Shadows ignore the transform: they're in device pixels.)
  if (band === "active") {
    ctx.shadowColor = "rgb(255 69 58 / 0.9)";
    ctx.shadowBlur = 5 * ratio;
    ctx.fillStyle = color;
    ctx.fill(outer);
  }
  ctx.shadowColor = "rgb(0 0 0 / 0.55)";
  ctx.shadowBlur = 3 * ratio;
  ctx.shadowOffsetY = 1 * ratio;
  ctx.fillStyle = color;
  ctx.fill(outer);
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = FLAME_STROKE;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.stroke(outer);
  ctx.fillStyle = "rgb(255 255 255 / 0.55)";
  ctx.fill(new Path2D(FLAME_INNER));
  return el;
}

function drawAqi(aqi: number, ratio: number) {
  const { color, text } = aqiCategory(aqi);
  const size = AQI_DOT + AQI_MARGIN * 2;
  const [el, ctx] = canvas(size, ratio);
  const c = size / 2;
  ctx.shadowColor = "rgb(0 0 0 / 0.45)";
  ctx.shadowBlur = 3 * ratio;
  ctx.shadowOffsetY = 1 * ratio;
  ctx.beginPath();
  ctx.arc(c, c, AQI_DOT / 2 - 0.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgb(0 0 0 / 0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = text;
  ctx.font = "700 10px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(aqi), c, c + 0.5);
  return el;
}

function draw(id: string, ratio: number): HTMLCanvasElement | null {
  const [kind, value] = id.split(":");
  if (kind === "flame" && CONTAINMENT_BANDS.some((b) => b.band === value)) return drawFlame(value as ContainmentBand, ratio);
  if (kind === "aqi" && /^\d{1,3}$/.test(value)) return drawAqi(Number(value), ratio);
  return null;
}

/** Draw icons as the map asks for them. Returns the cleanup. */
export function provideIcons(map: GLMap): () => void {
  const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id)) return;
    const el = draw(id, ratio);
    if (!el) return;
    const ctx = el.getContext("2d")!;
    map.addImage(id, ctx.getImageData(0, 0, el.width, el.height), { pixelRatio: ratio });
  });
  return () => {
    map.setMissingStyleImageResolver(null);
  };
}
