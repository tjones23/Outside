/**
 * How much of a model's precipitation falls as snow at a spot, and how
 * fluffy it lands — the step that turns "0.8 inches of water" into
 * "11 inches of snow".
 *
 * Every model reports liquid precipitation. Open-Meteo's own `snowfall` uses
 * a fixed 7:1 ratio, which badly undercounts cold mountain powder (20:1 and
 * up is common) and overcounts wet spring snow. So each hour is worked out
 * here instead, from the model's own temperatures:
 *
 * 1. **Snow or rain** — the wet-bulb temperature at the spot. Open-Meteo
 *    corrects 2 m temperature to the spot's real elevation, so a ridge gets
 *    snow while the model's smoother, lower terrain would have had rain.
 *    A layer warmer than ~1 °C aloft melts flakes on the way down (sleet or
 *    freezing rain), so that cuts the snow share too.
 * 2. **How fluffy** — the Kuchera method: the snow-to-liquid ratio falls as
 *    the warmest air in the column the flakes fall through rises. Only
 *    levels above the ground count: at a 10,000 ft resort the 850 hPa level
 *    is underground, and counting it would make every storm look wet.
 * 3. **Wind** packs snow down by breaking flakes, so strong wind lowers the
 *    ratio.
 *
 * Kuchera is a published, widely used method; the thresholds for steps 1 and
 * 3 are reasonable starting values, not tuned against observations.
 */

/** Wet-bulb temperature, °C, from temperature (°C) and relative humidity (%) — Stull (2011). */
export function wetBulb(tempC: number, rh: number): number {
  const r = Math.min(100, Math.max(1, rh));
  return (
    tempC * Math.atan(0.151977 * Math.sqrt(r + 8.313659)) +
    Math.atan(tempC + r) -
    Math.atan(r - 1.676331) +
    0.00391838 * r ** 1.5 * Math.atan(0.023101 * r) -
    4.686035
  );
}

/** All snow at or below this wet-bulb, °C… */
export const SNOW_WET_BULB = 0.5;
/** …all rain at or above this one, and a mix between. */
export const RAIN_WET_BULB = 2;

/** A layer aloft this warm (°C) starts melting flakes; one this warm melts them all. */
export const MELT_START = 1;
export const MELT_FULL = 3;

const ramp = (x: number, from: number, to: number) => Math.min(1, Math.max(0, (to - x) / (to - from)));

/**
 * The share of precipitation that reaches the ground as snow, 0–1.
 *
 * `warmestAloftC` is the warmest level above the ground (null if the model
 * has no levels); `modelShare` is the model's own snow share, used only when
 * there's no humidity to work out a wet-bulb from.
 */
export function snowShare(input: {
  tempC: number | null;
  rh: number | null;
  warmestAloftC: number | null;
  modelShare: number | null;
}): number {
  const { tempC, rh, warmestAloftC, modelShare } = input;
  let share: number;
  if (tempC !== null && rh !== null) share = ramp(wetBulb(tempC, rh), SNOW_WET_BULB, RAIN_WET_BULB);
  else if (modelShare !== null) share = modelShare;
  else if (tempC !== null) share = ramp(tempC, SNOW_WET_BULB + 0.5, RAIN_WET_BULB + 1);
  else return 0;
  if (warmestAloftC !== null) share *= ramp(warmestAloftC, MELT_START, MELT_FULL);
  return share;
}

/** One pressure level of a model's column. */
export interface Level {
  hPa: number;
  tempC: number;
}

/** The levels Outside asks for; 500 hPa is Kuchera's top. */
export const COLUMN_LEVELS = [1000, 925, 850, 700, 600, 500] as const;

/** Surface pressure, hPa, from elevation (m) in a standard atmosphere — when the model doesn't give one. */
export function standardPressure(elevationM: number): number {
  return 1013.25 * (1 - 2.25577e-5 * elevationM) ** 5.25588;
}

/**
 * The warmest temperature (°C) the flakes fall through: 2 m and every level
 * between the ground and 500 hPa. Levels below the ground are skipped.
 * Null when there are no usable levels — the 2 m temperature alone isn't a column.
 */
export function columnMax(levels: Level[], surfaceHPa: number, tempC: number | null): number | null {
  const above = levels.filter((l) => l.hPa <= surfaceHPa && l.hPa >= 500);
  if (above.length === 0) return null;
  const warmest = Math.max(...above.map((l) => l.tempC));
  return tempC === null ? warmest : Math.max(warmest, tempC);
}

/** The warmest level above the ground — a melting layer — or null without levels. */
export function warmestAloft(levels: Level[], surfaceHPa: number): number | null {
  const above = levels.filter((l) => l.hPa < surfaceHPa && l.hPa >= 500);
  return above.length === 0 ? null : Math.max(...above.map((l) => l.tempC));
}

/** Ratios outside this are noise, not weather: even champagne powder rarely beats 30:1 over hours. */
export const MIN_RATIO = 3;
export const MAX_RATIO = 30;

/**
 * Kuchera's snow-to-liquid ratio from the column's warmest temperature, °C:
 * 12:1 at −2 °C (271.16 K), one point more per degree colder, two less per
 * degree warmer.
 */
export function kucheraRatio(columnMaxC: number): number {
  const t = columnMaxC + 273.15;
  const ratio = t > 271.16 ? 12 + 2 * (271.16 - t) : 12 + (271.16 - t);
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** No effect up to 10 mph (4.5 m/s); down to 70% of the ratio at 30 mph (13.4 m/s) and above. */
export function windFactor(windMs: number | null): number {
  if (windMs === null) return 1;
  return 1 - 0.3 * Math.min(1, Math.max(0, (windMs - 4.5) / (13.4 - 4.5)));
}

export function snowRatio(columnMaxC: number, windMs: number | null): number {
  return Math.max(MIN_RATIO, kucheraRatio(columnMaxC) * windFactor(windMs));
}
