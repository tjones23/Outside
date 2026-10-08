import type { RadarFrame } from "./types";

/**
 * Rain-and-snow radar: what the browser needs to know about it.
 *
 * The frames are drawn by this server from NOAA's MRMS (Multi-Radar
 * Multi-Sensor) mosaic — see `mrms.ts` for how, and `sources/mrms-store.ts`
 * for when. This file has only the shared constants, so the map and legend
 * can use them without pulling in the decoder.
 */

export const PRECIP_TYPE_ATTRIBUTION = "NOAA MRMS";
export const PRECIP_TYPE_ATTRIBUTION_HTML = '<a href="https://www.nssl.noaa.gov/projects/mrms/">NOAA MRMS</a>';

/** One frame every ten minutes, the same cadence as RainViewer's. */
export const PRECIP_TYPE_STEP_SECONDS = 600;
/** Last hour, like the RainViewer loop. */
export const PRECIP_TYPE_FRAMES = 7;

/**
 * Tiles are drawn for zooms 3–9. MRMS's ~1 km grid is about zoom 7's pixel
 * size, but tiles blend between cells rather than copying them, so drawing
 * deeper keeps edges smooth where the map zooms to a place (9); past that,
 * zoom-9 tiles are stretched (`maxNativeZoom`).
 */
export const PRECIP_TYPE_MIN_ZOOM = 3;
export const PRECIP_TYPE_MAX_NATIVE_ZOOM = 9;

export function precipTypeTileUrl(time: number): string {
  return `/api/mrms/${time}/{z}/{x}/{y}.png`;
}

export function precipTypeFrame(time: number): RadarFrame {
  return { time, url: precipTypeTileUrl(time) };
}

export type PrecipKind = "rain" | "snow";

/**
 * Color per 5 dBZ step from 5 to 70, one scale per kind.
 *
 * Rain starts in greens rather than NWS's cyan and blue, so that blue only
 * ever means snow. From 20 dBZ up it is the familiar NWS scale.
 */
export const PRECIP_SCALES: Record<PrecipKind, [dbz: number, color: string][]> = {
  rain: [
    [5, "#A8E6A3"],
    [10, "#76D46F"],
    [15, "#3FBF3A"],
    [20, "#02FD02"],
    [25, "#01C501"],
    [30, "#008E00"],
    [35, "#FDF802"],
    [40, "#E5BC00"],
    [45, "#FD9500"],
    [50, "#FD0000"],
    [55, "#D40000"],
    [60, "#BC0000"],
    [65, "#F800FD"],
    [70, "#9854C6"],
  ],
  snow: [
    [5, "#D4EBFF"],
    [10, "#B0D7FF"],
    [15, "#86BCFF"],
    [20, "#5C9DF7"],
    [25, "#3A7BE6"],
    [30, "#245AD0"],
    [35, "#1A3FB0"],
    [40, "#1B2A90"],
    [45, "#2A1E85"],
    [50, "#3D1A85"],
    [55, "#521A8A"],
    [60, "#661A90"],
    [65, "#7A1A96"],
    [70, "#8E1A9C"],
  ],
};

export const PRECIP_KINDS: readonly PrecipKind[] = ["rain", "snow"];
