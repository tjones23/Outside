"use client";

import { useCallback, useEffect, useState } from "react";
import { formatClock, formatDayClock } from "@/lib/format";
import { OVERLAY_PREFIX, slotEnd } from "@/lib/map-style";
import type { RadarFrame } from "@/lib/types";
import { useNow } from "../providers/useNow";
import { useGL } from "./gl";

/**
 * Animated map imagery: composite radar, and forecast animations.
 *
 * Each frame is its own raster source and layer, and only the current one is
 * opaque, so stepping through the loop toggles opacity — no re-fetch, no
 * flicker.
 *
 * RainViewer's free tier allows 500 tile requests a minute per IP (300 in a
 * burst), and one continental view is ~25 tiles per frame. Mounting every
 * frame at once blows through that on the first pan. So the loop is the last
 * hour only, and frames are loaded one after another, newest first: the
 * latest shows immediately, older ones join the animation as they arrive,
 * and moving the map starts the sequence again for the new view.
 *
 * Forecast animations reuse the same machinery in the other direction: the
 * frame nearest now first, later ones joining as they load — which is also
 * what keeps a few dozen frames from the forecast servers arriving at once.
 */

const STEP_MS = 600;
/** Last hour, at RainViewer's ten-minute cadence. */
export const RADAR_LOOP_FRAMES = 7;
/** Pause between finishing one frame and starting the next. */
const PRELOAD_GAP_MS = 700;

/**
 * Which end of the loop loads first. Radar starts from the newest frame and
 * reaches back into the past; a forecast starts from the frame nearest now
 * and reaches forward.
 */
export type LoadOrder = "newest-first" | "oldest-first";

export interface FramePlayback {
  frames: RadarFrame[];
  /** The loaded frames for the current view are `lo` through `hi`, inclusive. */
  lo: number;
  hi: number;
  index: number;
  playing: boolean;
  /** Counts pans and zooms, so the preloader restarts even when `lo`/`hi` don't change. */
  view: number;
  /** True while frames are still being added for this view. */
  loading: boolean;
  setPlaying: (playing: boolean) => void;
  seek: (index: number) => void;
  /** The last frame loaded so far has its tiles, with `ready` loaded in all: mount the next one. */
  loadNext: (ready: number) => void;
  viewChanged: () => void;
}

interface PlaybackState {
  frames: RadarFrame[] | null;
  /** How many frames, counting from the starting end, are mounted. */
  ready: number;
  index: number;
  view: number;
}

/**
 * Playback over `frames`, which must keep its identity until the frames
 * actually change (memoize it): a new array starts over with one frame loaded.
 */
export function useFramePlayback(frames: RadarFrame[], order: LoadOrder): FramePlayback {
  const count = frames.length;
  const last = Math.max(0, count - 1);
  const start = order === "newest-first" ? last : 0;

  // All playback state belongs to one frame list; a new one starts over with
  // only its starting frame loaded, showing it.
  const [stored, setState] = useState<PlaybackState>({ frames: null, ready: 1, index: 0, view: 0 });
  const current = useCallback(
    (s: PlaybackState): PlaybackState => (s.frames === frames ? s : { frames, ready: 1, index: start, view: s.view }),
    [frames, start],
  );
  const state = current(stored);
  const range = useCallback(
    (ready: number): [number, number] =>
      order === "newest-first" ? [Math.max(0, count - ready), last] : [0, Math.min(last, ready - 1)],
    [order, count, last],
  );
  const [lo, hi] = range(state.ready);
  const [playing, setPlaying] = useState(true);

  const looping = playing && hi - lo >= 1;
  useEffect(() => {
    if (!looping) return;
    const id = window.setInterval(() => {
      setState((prev) => {
        const s = current(prev);
        const [a, b] = range(s.ready);
        return { ...s, index: s.index >= b ? a : Math.max(a, s.index + 1) };
      });
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [looping, current, range]);

  const seek = useCallback(
    (i: number) => {
      setPlaying(false);
      setState((prev) => ({ ...current(prev), index: i }));
    },
    [current],
  );
  const loadNext = useCallback(
    (ready: number) =>
      setState((prev) => {
        const s = current(prev);
        return s.ready === ready && s.ready < count ? { ...s, ready: ready + 1 } : s;
      }),
    [current, count],
  );
  const viewChanged = useCallback(
    () => setState((prev) => ({ ...current(prev), ready: 1, index: start, view: prev.view + 1 })),
    [current, start],
  );

  return {
    frames,
    lo,
    hi,
    index: Math.min(Math.max(state.index, lo), hi),
    playing,
    view: state.view,
    loading: hi - lo + 1 < count,
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
  attribution?: string;
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
      attribution,
    });
    map.addLayer(
      {
        id,
        type: "raster",
        source: id,
        paint: { "raster-opacity": 0, "raster-fade-duration": 0, "raster-opacity-transition": { duration: 0 } },
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
  order,
  maxNativeZoom,
  attribution,
}: {
  playback: FramePlayback;
  opacity: number;
  order: LoadOrder;
  maxNativeZoom: number;
  /** Attribution HTML, put on one frame only. */
  attribution: string;
}) {
  const { map } = useGL();
  const { frames, lo, hi, index, view, loadNext, viewChanged } = playback;

  useEffect(() => {
    map.on("moveend", viewChanged);
    return () => {
      map.off("moveend", viewChanged);
    };
  }, [map, viewChanged]);

  const edge = frames[order === "newest-first" ? lo : hi];
  const ready = hi - lo + 1;

  // Once the most recently mounted frame has its tiles, queue the next one.
  // MapLibre reports a source's progress as `sourcedata` events; a view that
  // needed no tiles, or whose tiles landed before this ran, is loaded already.
  useEffect(() => {
    if (!edge || ready >= frames.length) return;
    const id = frameSource(edge);
    let timer: number | undefined;
    let queued = false;
    const check = () => {
      if (queued || !map.getSource(id) || !map.isSourceLoaded(id)) return;
      queued = true;
      timer = window.setTimeout(() => loadNext(ready), PRELOAD_GAP_MS);
    };
    map.on("sourcedata", check);
    map.on("idle", check);
    check();
    return () => {
      map.off("sourcedata", check);
      map.off("idle", check);
      window.clearTimeout(timer);
    };
  }, [map, edge, ready, frames.length, view, loadNext]);

  const attributionAt = order === "newest-first" ? frames.length - 1 : 0;

  return (
    <>
      {frames.map((frame, i) =>
        i < lo || i > hi ? null : (
          <Frame
            key={frame.time}
            frame={frame}
            opacity={i === index ? opacity : 0}
            maxNativeZoom={maxNativeZoom}
            attribution={i === attributionAt ? attribution : undefined}
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
          {playback.loading ? `Loading ${loaded}/${playback.frames.length}` : attribution}
        </span>
      </span>
    </div>
  );
}
