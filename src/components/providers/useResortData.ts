"use client";

import { useEffect, useState } from "react";
import type { Resort, StateShapes } from "@/lib/resorts";

/**
 * The resort list and state outlines, from `public/` (built by
 * `scripts/build-resorts.ts`). Loaded once per page and only when something
 * asks: they're static files, 300 KB between them.
 */

export interface ResortData {
  season: string;
  resorts: Resort[];
  states: StateShapes;
}

let loading: Promise<ResortData | null> | null = null;

function load(): Promise<ResortData | null> {
  loading ??= Promise.all([
    fetch("/resorts.json").then((r) => (r.ok ? (r.json() as Promise<{ season: string; resorts: Resort[] }>) : null)),
    fetch("/states.json").then((r) => (r.ok ? (r.json() as Promise<StateShapes>) : null)),
  ])
    .then(([resorts, states]) => (resorts && states ? { ...resorts, states } : null))
    .catch(() => null)
    .then((data) => {
      // Let a failed load be retried on the next mount.
      if (!data) loading = null;
      return data;
    });
  return loading;
}

/** `undefined` while loading, `null` if it failed. */
export function useResortData(enabled = true): ResortData | null | undefined {
  const [data, setData] = useState<ResortData | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [enabled]);
  return data;
}
