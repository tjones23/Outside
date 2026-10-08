"use client";

import type { TileLayer as LeafletTileLayer, WMSParams } from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TileLayer, useMapEvents, WMSTileLayer } from "react-leaflet";
import { formatClock, formatDayClock } from "@/lib/format";
import type { RadarFrame } from "@/lib/types";
import { useNow } from "../providers/useNow";

/**
 * Animated map imagery: composite radar, and forecast animations.
 *
 * Each frame is its own tile layer and only the current one is opaque, so
 * stepping through the loop toggles opacity — no re-fetch, no flicker.
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

/** WMS GetMap parameters per frame, kept stable so Leaflet doesn't redraw on every render. */
function useWmsParams(frames: RadarFrame[]): Map<number, WMSParams> {
  return useMemo(() => {
    const out = new Map<number, WMSParams>();
    for (const f of frames) {
      if (f.wms) {
        out.set(f.time, { layers: f.wms.layers, format: "image/png", transparent: true, ...f.wms.params } as WMSParams);
      }
    }
    return out;
  }, [frames]);
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
  /** Leaflet attribution HTML, put on one frame only. */
  attribution: string;
}) {
  const { frames, lo, hi, index, view, loadNext, viewChanged } = playback;
  useMapEvents(useMemo(() => ({ moveend: viewChanged }), [viewChanged]));
  const wmsParams = useWmsParams(frames);

  const layers = useRef(new Map<number, LeafletTileLayer>());
  const edge = frames[order === "newest-first" ? lo : hi];
  const ready = hi - lo + 1;

  // Once the most recently mounted frame has its tiles, queue the next one.
  // Its `load` event alone isn't enough: Leaflet fires it only after fetching
  // tiles, so a move that needed none (or whose tiles landed before this ran)
  // would leave the loop stuck on one frame.
  useEffect(() => {
    const layer = edge && layers.current.get(edge.time);
    if (!layer || ready >= frames.length) return;
    let timer: number | undefined;
    const next = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => loadNext(ready), PRELOAD_GAP_MS);
    };
    if (layer.isLoading()) layer.on("load", next);
    else next();
    return () => {
      layer.off("load", next);
      window.clearTimeout(timer);
    };
  }, [edge, ready, frames.length, view, loadNext]);

  const attributionAt = order === "newest-first" ? frames.length - 1 : 0;

  return (
    <>
      {frames.map((frame, i) => {
        if (i < lo || i > hi) return null;
        const ref = (layer: LeafletTileLayer | null) => {
          if (!layer) return;
          layers.current.set(frame.time, layer);
          return () => {
            layers.current.delete(frame.time);
          };
        };
        const common = {
          opacity: i === index ? opacity : 0,
          zIndex: 5,
          // Past the source's native zoom Leaflet stretches its tiles instead
          // of requesting ones that don't exist (or are placeholders).
          maxNativeZoom,
          maxZoom: 19,
          noWrap: true,
          // As the base map: let tiles scale through a zoom, not reload mid-gesture.
          updateWhenZooming: false,
          keepBuffer: 4,
          attribution: i === attributionAt ? attribution : undefined,
        };
        const params = wmsParams.get(frame.time);
        return params ? (
          <WMSTileLayer key={frame.time} ref={ref} url={frame.url} params={params} uppercase {...common} />
        ) : (
          <TileLayer key={frame.time} ref={ref} url={frame.url} {...common} />
        );
      })}
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
