"use client";

import { useCallback, useEffect, useState } from "react";
import { formatClock, formatDayClock } from "@/lib/format";
import {
  carryOver,
  grow,
  restartFrom,
  single,
  startOf,
  step,
  type FrameWindow,
  type LoadOrder,
} from "@/lib/frame-window";
import { OVERLAY_PREFIX, slotEnd } from "@/lib/map-style";
import type { RadarFrame } from "@/lib/types";
import { useNow } from "../providers/useNow";
import { useGL } from "./gl";

export type { LoadOrder } from "@/lib/frame-window";

/**
 * Animated map imagery: composite radar, and forecast animations.
 *
 * Each frame is its own raster source and layer, and only the current one is
 * opaque, so stepping through the loop changes opacity — no re-fetch. Each
 * step crossfades into the next, and the loop holds on its last frame before
 * starting over, so the eye can follow storms from frame to frame.
 *
 * Frames are mounted one after another (see `lib/frame-window.ts`), so the
 * first view isn't a wall of tile requests and the starting frame shows
 * first. The loop only plays once every frame is mounted and has its tiles
 * for the view: until then it holds the frame on screen, rather than
 * flicking through frames that are still blank.
 *
 * What happens when the map moves depends on whose tiles they are. Radar is
 * drawn by this server and its tiles never change, so every frame stays
 * mounted and MapLibre fetches the new view for all of them; the loop holds
 * where it was until they're in, then carries on. Forecast tiles come from
 * IEM's and NWS's servers, which don't take kindly to a few dozen frames'
 * worth at once, so a move keeps only the frame on screen and loads the rest
 * again from there.
 */

const STEP_MS = 400;
/** How long the last frame stays up before the loop starts over. */
const HOLD_MS = 1800;
/** Each step's crossfade: most of a step, so motion reads as motion rather than jumps. */
const FADE_MS = 250;
/** The longest playback waits on tiles after a move before playing what it has. */
const MAX_HOLD_MS = 10_000;
/** Pause between one frame having its tiles and mounting the next. */
const PRELOAD_GAP_MS = { own: 100, rateLimited: 700 };

export interface FramePlayback {
  frames: RadarFrame[];
  order: LoadOrder;
  /** Tiles come from someone else's servers: moving the map loads frames again, one at a time. */
  rateLimited: boolean;
  /** The mounted frames are `lo` through `hi`, inclusive. */
  lo: number;
  hi: number;
  /** The frame mounted most recently. */
  edge: number;
  index: number;
  playing: boolean;
  /** Counts the moves that restarted loading, so the preloader restarts even when the window doesn't change. */
  view: number;
  /** True while frames are still being added. */
  loading: boolean;
  /** Some mounted frame is still fetching tiles for this view. */
  buffering: boolean;
  setBuffering: (buffering: boolean) => void;
  setPlaying: (playing: boolean) => void;
  seek: (index: number) => void;
  /** Frame `edge` has its tiles: mount the next one. */
  loadNext: (edge: number) => void;
  viewChanged: () => void;
}

interface PlaybackState {
  frames: RadarFrame[];
  window: FrameWindow;
  index: number;
  view: number;
}

const times = (frames: readonly RadarFrame[]) => frames.map((f) => f.time);

/**
 * Playback over `frames`, which must keep its identity until the frames
 * actually change (memoize it). A new list keeps playing at the same time:
 * radar keeps the frames it had mounted, a rate-limited loop starts loading
 * again from the frame on screen.
 */
export function useFramePlayback(
  frames: RadarFrame[],
  order: LoadOrder,
  { rateLimited = false }: { rateLimited?: boolean } = {},
): FramePlayback {
  const count = frames.length;

  const [stored, setState] = useState<PlaybackState | null>(null);
  const current = useCallback(
    (s: PlaybackState | null): PlaybackState => {
      if (s?.frames === frames) return s;
      let moved: { window: FrameWindow; index: number };
      if (!s) {
        const start = startOf(count, order);
        moved = { window: single(start), index: start };
      } else if (rateLimited) {
        moved = restartFrom(times(s.frames), s.index, times(frames), order);
      } else {
        moved = carryOver(times(s.frames), s.window, s.index, times(frames), order);
      }
      return { frames, ...moved, view: s?.view ?? 0 };
    },
    [frames, count, order, rateLimited],
  );
  const state = current(stored);
  const { lo, hi, edge } = state.window;
  const index = Math.min(Math.max(state.index, lo), hi);
  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const loading = hi - lo + 1 < count;

  // A timeout per step rather than an interval, so the last frame can hold.
  // Nothing steps until every frame is mounted and has its tiles.
  const looping = playing && !loading && !buffering && hi > lo;
  useEffect(() => {
    if (!looping) return;
    const id = window.setTimeout(
      () =>
        setState((prev) => {
          const s = current(prev);
          return { ...s, index: step(s.index, s.window) };
        }),
      index >= hi ? HOLD_MS : STEP_MS,
    );
    return () => window.clearTimeout(id);
  }, [looping, index, hi, current]);

  const seek = useCallback(
    (i: number) => {
      setPlaying(false);
      setState((prev) => ({ ...current(prev), index: i }));
    },
    [current],
  );
  const loadNext = useCallback(
    (from: number) =>
      setState((prev) => {
        const s = current(prev);
        const w = s.window.edge === from ? grow(s.window, count, order) : null;
        return w ? { ...s, window: w } : s;
      }),
    [current, count, order],
  );
  const viewChanged = useCallback(
    () =>
      setState((prev) => {
        const s = current(prev);
        return { ...s, window: single(s.index), view: s.view + 1 };
      }),
    [current],
  );

  return {
    frames,
    order,
    rateLimited,
    lo,
    hi,
    edge,
    index,
    playing,
    view: state.view,
    loading,
    buffering,
    setBuffering,
    setPlaying,
    seek,
    loadNext,
    viewChanged,
  };
}

const frameSource = (frame: RadarFrame) => `${OVERLAY_PREFIX}frame:${frame.time}`;

/** One frame: a raster source and layer, shown at `opacity` (0 while it waits its turn). */
function Frame({
  frame,
  opacity,
  maxNativeZoom,
  attribution,
}: {
  frame: RadarFrame;
  opacity: number;
  maxNativeZoom: number;
  attribution: string;
}) {
  const { map } = useGL();
  const id = frameSource(frame);

  useEffect(() => {
    map.addSource(id, {
      type: "raster",
      // MapLibre wants absolute tile URLs; ours may be this server's paths.
      tiles: [frame.url.startsWith("/") ? window.location.origin + frame.url : frame.url],
      tileSize: 256,
      // Past the source's native zoom MapLibre stretches its tiles instead
      // of requesting ones that don't exist (or are placeholders).
      maxzoom: maxNativeZoom,
      // On every frame, so it doesn't move (and remount a frame) as the
      // loop's ends change; MapLibre lists each attribution once.
      attribution,
    });
    map.addLayer(
      {
        id,
        type: "raster",
        source: id,
        paint: {
          "raster-opacity": 0,
          "raster-fade-duration": 0,
          "raster-opacity-transition": { duration: FADE_MS, delay: 0 },
        },
      },
      slotEnd("imagery"),
    );
    return () => {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        // The map is already gone.
      }
    };
  }, [map, id, frame.url, maxNativeZoom, attribution]);

  useEffect(() => {
    if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", opacity);
  }, [map, id, opacity]);

  return null;
}

export function FrameLayer({
  playback,
  opacity,
  maxNativeZoom,
  attribution,
}: {
  playback: FramePlayback;
  opacity: number;
  maxNativeZoom: number;
  /** Attribution HTML. */
  attribution: string;
}) {
  const { map } = useGL();
  const { frames, lo, hi, edge, index, view, rateLimited, loading, loadNext, viewChanged, setBuffering } = playback;

  useEffect(() => {
    if (!rateLimited) return;
    map.on("moveend", viewChanged);
    return () => {
      map.off("moveend", viewChanged);
    };
  }, [map, rateLimited, viewChanged]);

  const edgeFrame = frames[edge];

  // Once the most recently mounted frame has its tiles, queue the next one.
  // MapLibre reports a source's progress as `sourcedata` events; a view that
  // needed no tiles, or whose tiles landed before this ran, is loaded already.
  useEffect(() => {
    if (!edgeFrame || !loading) return;
    const id = frameSource(edgeFrame);
    const gap = rateLimited ? PRELOAD_GAP_MS.rateLimited : PRELOAD_GAP_MS.own;
    let timer: number | undefined;
    let queued = false;
    const check = () => {
      if (queued || !map.getSource(id) || !map.isSourceLoaded(id)) return;
      queued = true;
      timer = window.setTimeout(() => loadNext(edge), gap);
    };
    map.on("sourcedata", check);
    map.on("idle", check);
    check();
    return () => {
      map.off("sourcedata", check);
      map.off("idle", check);
      window.clearTimeout(timer);
    };
  }, [map, edgeFrame, edge, loading, rateLimited, view, loadNext]);

  // Whether every mounted frame has its tiles for the view, kept up to date
  // as the map moves: a pan or zoom sets them all fetching again, and
  // playback holds until they're in. (A tile that failed counts as in; one
  // that never answers gives up the hold after `MAX_HOLD_MS`.)
  const mounted = frames
    .slice(lo, hi + 1)
    .map(frameSource)
    .join("\n");
  useEffect(() => {
    const ids = mounted.split("\n");
    let since: number | null = null;
    let timer: number | undefined;
    const check = () => {
      if (ids.every((id) => map.getSource(id) && map.isSourceLoaded(id))) {
        since = null;
        window.clearTimeout(timer);
        setBuffering(false);
        return;
      }
      if (since === null) {
        since = Date.now();
        timer = window.setTimeout(check, MAX_HOLD_MS);
      }
      setBuffering(Date.now() - since < MAX_HOLD_MS);
    };
    map.on("dataloading", check);
    map.on("sourcedata", check);
    map.on("idle", check);
    check();
    return () => {
      map.off("dataloading", check);
      map.off("sourcedata", check);
      map.off("idle", check);
      window.clearTimeout(timer);
    };
  }, [map, mounted, setBuffering]);

  return (
    <>
      {frames.map((frame, i) =>
        i < lo || i > hi ? null : (
          <Frame
            key={frame.time}
            frame={frame}
            opacity={i === index ? opacity : 0}
            maxNativeZoom={maxNativeZoom}
            attribution={attribution}
          />
        ),
      )}
    </>
  );
}

export function FrameTimeline({
  playback,
  label,
  attribution,
  withDay = false,
}: {
  playback: FramePlayback;
  /** What's playing, e.g. "Radar" or "HRRR future radar". */
  label: string;
  attribution: string;
  /** Show the weekday too — for loops that span days. */
  withDay?: boolean;
}) {
  const frame = playback.frames[playback.index];
  const ms = frame ? frame.time * 1000 : 0;
  const now = useNow();
  const loaded = playback.hi - playback.lo + 1;
  return (
    <div className="flex items-center gap-3 rounded-full border border-line bg-ink/85 px-2 py-1.5 shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => playback.setPlaying(!playback.playing)}
        aria-label={playback.playing ? `Pause ${label}` : `Play ${label}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text hover:bg-line"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          {playback.playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5v14l11-7z" />}
        </svg>
      </button>
      <input
        type="range"
        aria-label={`${label} frame`}
        className="min-w-0 flex-1"
        min={playback.lo}
        max={playback.hi}
        step={1}
        value={playback.index}
        onChange={(e) => playback.seek(Number(e.target.value))}
      />
      <span className="shrink-0 pr-2 text-right text-xs tabular-nums text-muted">
        {frame ? (withDay ? formatDayClock(ms) : formatClock(ms)) : "—"}
        {now > 0 && ms > now && <span className="text-accent"> · forecast</span>}
        <span className="block text-[10px] text-muted-dim">
          {playback.loading
            ? `Loading ${loaded}/${playback.frames.length}`
            : playback.buffering
              ? "Loading…"
              : attribution}
        </span>
      </span>
    </div>
  );
}
