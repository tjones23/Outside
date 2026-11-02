/**
 * Which frames of an animation are mounted on the map — the bookkeeping
 * behind `components/map/radar.tsx`, kept pure so it tests without a map.
 *
 * The mounted frames are always one contiguous run, `lo` through `hi`. It
 * starts as a single frame and grows one frame at a time, each joining once
 * the last one (`edge`) has its tiles: forward first for a forecast, back
 * into the past first for radar, then the other way once that end is reached.
 */

/**
 * Which end of the loop loads first. Radar starts from the newest frame and
 * reaches back into the past; a forecast starts from the frame nearest now
 * and reaches forward.
 */
export type LoadOrder = "newest-first" | "oldest-first";

export interface FrameWindow {
  lo: number;
  hi: number;
  /** The frame mounted most recently, whose tiles decide when the next one joins. */
  edge: number;
}

/** Just frame `i`. */
export function single(i: number): FrameWindow {
  return { lo: i, hi: i, edge: i };
}

/** The frame a loop of `count` frames starts from. */
export function startOf(count: number, order: LoadOrder): number {
  return order === "newest-first" ? Math.max(0, count - 1) : 0;
}

/** The window with one more frame, or null when all `count` are mounted. */
export function grow(w: FrameWindow, count: number, order: LoadOrder): FrameWindow | null {
  const back = w.lo > 0 ? { ...w, lo: w.lo - 1, edge: w.lo - 1 } : null;
  const forward = w.hi < count - 1 ? { ...w, hi: w.hi + 1, edge: w.hi + 1 } : null;
  return order === "newest-first" ? (back ?? forward) : (forward ?? back);
}

/** The next frame to show: one step on, wrapping from `hi` to `lo`. */
export function step(index: number, w: FrameWindow): number {
  return index >= w.hi ? w.lo : Math.max(w.lo, index + 1);
}

/**
 * A new frame list replacing `prev`, for loops whose frames keep their tiles
 * (the same time always means the same imagery): the frames mounted before
 * stay mounted, and playback stays on the same time. A frame that aged out
 * hands over to the oldest one left; none left starts over.
 */
export function carryOver(
  prev: readonly number[],
  w: FrameWindow,
  index: number,
  next: readonly number[],
  order: LoadOrder,
): { window: FrameWindow; index: number } {
  const mounted = new Set(prev.slice(w.lo, w.hi + 1));
  const kept = next.flatMap((t, i) => (mounted.has(t) ? [i] : []));
  if (kept.length === 0) {
    const start = startOf(next.length, order);
    return { window: single(start), index: start };
  }
  const lo = kept[0];
  const hi = kept[kept.length - 1];
  const at = next.indexOf(prev[index]);
  return { window: { lo, hi, edge: hi }, index: at >= lo && at <= hi ? at : lo };
}

/**
 * A new frame list replacing `prev`, for loops whose tiles are fetched from
 * someone else's servers and may change under the same time (a new model
 * run): only the frame on screen stays, if it's still there, and the rest
 * load again from it.
 */
export function restartFrom(
  prev: readonly number[],
  index: number,
  next: readonly number[],
  order: LoadOrder,
): { window: FrameWindow; index: number } {
  const at = next.indexOf(prev[index]);
  const i = at >= 0 ? at : startOf(next.length, order);
  return { window: single(i), index: i };
}
