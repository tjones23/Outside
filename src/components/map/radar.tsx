"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TileLayer, useMapEvents } from "react-leaflet";
import { formatClock } from "@/lib/format";
import { RADAR_MAX_NATIVE_ZOOM } from "@/lib/radar";
import type { RadarFrame, RadarManifest } from "@/lib/types";
import { useNow } from "../providers/useNow";

/**
 * Animated composite radar.
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
 */

const STEP_MS = 600;
/** Last hour, at RainViewer's ten-minute cadence. */
const MAX_FRAMES = 7;
/** Pause between finishing one frame and starting the next. */
const PRELOAD_GAP_MS = 700;

export interface RadarPlayback {
  frames: RadarFrame[];
  /** Frames at or after this index are loaded for the current view. */
  firstReady: number;
  index: number;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  seek: (index: number) => void;
  frameLoaded: (index: number) => void;
  viewChanged: () => void;
}

export function useRadarPlayback(manifest: RadarManifest | null): RadarPlayback {
  const frames = useMemo(
    () => (manifest ? [...manifest.past.slice(-MAX_FRAMES), ...manifest.nowcast] : []),
    [manifest],
  );
  const last = Math.max(0, frames.length - 1);

  // All playback state is keyed by the manifest, so a new one starts fresh:
  // only the newest frame loaded, showing it.
  const [state, setState] = useState<{ manifest: RadarManifest | null; ready: number; index: number }>({
    manifest: null,
    ready: 1,
    index: 0,
  });
  const current = state.manifest === manifest ? state : { manifest, ready: 1, index: last };
  const firstReady = Math.max(0, frames.length - current.ready);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing || frames.length - firstReady < 2) return;
    const id = window.setInterval(() => {
      setState((s) => {
        const c = s.manifest === manifest ? s : { manifest, ready: 1, index: last };
        const lo = Math.max(0, frames.length - c.ready);
        return { ...c, index: c.index >= last ? lo : Math.max(lo, c.index + 1) };
      });
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [playing, frames.length, firstReady, manifest, last]);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    frames,
    firstReady,
    index: Math.min(Math.max(current.index, firstReady), last),
    playing,
    setPlaying,
    seek: (i) => {
      setPlaying(false);
      setState({ ...current, index: i });
    },
    frameLoaded: (i) => {
      // Only the oldest frame loaded so far unlocks the next one.
      if (i !== firstReady || current.ready >= frames.length) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        setState((s) => {
          const c = s.manifest === manifest ? s : { manifest, ready: 1, index: last };
          return c.ready === current.ready ? { ...c, ready: c.ready + 1 } : c;
        });
      }, PRELOAD_GAP_MS);
    },
    viewChanged: () => {
      clearTimeout(timer.current);
      setState((s) => {
        const c = s.manifest === manifest ? s : { manifest, ready: 1, index: last };
        return { ...c, ready: 1, index: last };
      });
    },
  };
}

export function RadarLayer({ playback, opacity }: { playback: RadarPlayback; opacity: number }) {
  const { frames, firstReady, index, frameLoaded, viewChanged } = playback;
  useMapEvents({ moveend: viewChanged });
  const loadedRef = useRef(frameLoaded);
  useEffect(() => {
    loadedRef.current = frameLoaded;
  });

  return (
    <>
      {frames.map((frame, i) =>
        i < firstReady ? null : (
          <TileLayer
            key={frame.time}
            url={frame.url}
            opacity={i === index ? opacity : 0}
            zIndex={5}
            // The free tier stops at zoom 7; past it Leaflet stretches z7
            // tiles instead of requesting "zoom not supported" placeholders.
            maxNativeZoom={RADAR_MAX_NATIVE_ZOOM}
            maxZoom={19}
            noWrap
            attribution={i === frames.length - 1 ? '<a href="https://www.rainviewer.com/">RainViewer</a>' : undefined}
            eventHandlers={{ load: () => loadedRef.current(i) }}
          />
        ),
      )}
    </>
  );
}

export function RadarTimeline({ playback, attribution }: { playback: RadarPlayback; attribution: string }) {
  const frame = playback.frames[playback.index];
  const ms = frame ? frame.time * 1000 : 0;
  const now = useNow();
  const loading = playback.firstReady > 0;
  return (
    <div className="flex items-center gap-3 rounded-full border border-line bg-ink/85 px-2 py-1.5 shadow-lg backdrop-blur-md">
      <button
        type="button"
        onClick={() => playback.setPlaying(!playback.playing)}
        aria-label={playback.playing ? "Pause radar" : "Play radar"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text hover:bg-line"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          {playback.playing ? <path d="M7 5h3v14H7zM14 5h3v14h-3z" /> : <path d="M8 5v14l11-7z" />}
        </svg>
      </button>
      <input
        type="range"
        aria-label="Radar frame"
        className="min-w-0 flex-1"
        min={playback.firstReady}
        max={Math.max(0, playback.frames.length - 1)}
        step={1}
        value={playback.index}
        onChange={(e) => playback.seek(Number(e.target.value))}
      />
      <span className="shrink-0 pr-2 text-right text-xs tabular-nums text-muted">
        {frame ? formatClock(ms) : "—"}
        {now > 0 && ms > now && <span className="text-accent"> · forecast</span>}
        <span className="block text-[10px] text-muted-dim">
          {loading ? `Loading ${playback.frames.length - playback.firstReady}/${playback.frames.length}` : attribution}
        </span>
      </span>
    </div>
  );
}
