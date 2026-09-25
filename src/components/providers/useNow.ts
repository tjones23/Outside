"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, ticking every 15 seconds — for "updated 3 min ago" and
 * "Today"/"Yesterday" labels.
 *
 * An external store rather than state initialized from `Date.now()`, so a
 * prerender never bakes a build-time clock into the page: the server snapshot
 * is 0, and the real time arrives with hydration. One shared timer serves
 * every component that asks.
 */

const TICK_MS = 15_000;
let current = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    timer = setInterval(() => {
      current = Date.now();
      for (const l of listeners) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function getSnapshot(): number {
  if (current === 0 || !timer) current = Date.now();
  return current;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, () => 0);
}
