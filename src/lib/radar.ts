import type { RadarFrame, RadarManifest } from "./types";

/**
 * RainViewer composite radar. Ported from `RadarService.cs`.
 *
 * https://www.rainviewer.com/api/weather-maps-api.html — free and keyless.
 * The manifest lists recent frames; each becomes a Leaflet tile template.
 */

export const RAINVIEWER_MANIFEST_URL = "https://api.rainviewer.com/public/weather-maps.json";

export const RADAR_ATTRIBUTION = "RainViewer";

// Baked into every tile URL. Palette 6 is RainViewer's NEXRAD-style scheme, to
// match the NWS look; "1_1" is {smooth}_{snow}.
const TILE_SIZE = 256;
const PALETTE = 6;
const OPTIONS = "1_1";

/**
 * The deepest zoom RainViewer's free tier serves. Past it Leaflet should
 * stretch zoom-7 tiles (`maxNativeZoom`) rather than request tiles that 404.
 */
export const RADAR_MAX_NATIVE_ZOOM = 7;

function frames(radar: Record<string, unknown>, key: string, host: string): RadarFrame[] {
  const list = radar[key];
  if (!Array.isArray(list)) return [];
  const out: RadarFrame[] = [];
  for (const f of list) {
    const path = (f as { path?: unknown })?.path;
    if (typeof path !== "string") continue;
    const time = (f as { time?: unknown }).time;
    out.push({
      time: typeof time === "number" ? time : 0,
      url: `${host}${path}/${TILE_SIZE}/{z}/{x}/{y}/${PALETTE}/${OPTIONS}.png`,
    });
  }
  return out;
}

/** null when the manifest has no host or no radar section. */
export function parseRadarManifest(json: unknown): RadarManifest | null {
  const root = json as Record<string, unknown> | null;
  const host = typeof root?.host === "string" ? root.host : "";
  const radar = root?.radar;
  if (!host || !radar || typeof radar !== "object") return null;

  return {
    past: frames(radar as Record<string, unknown>, "past", host),
    nowcast: frames(radar as Record<string, unknown>, "nowcast", host),
    generated: typeof root?.generated === "number" ? root.generated : 0,
    attribution: RADAR_ATTRIBUTION,
  };
}
