"use client";

import { useEffect, useState } from "react";

/**
 * Poll one `/api/*` route while the page is open.
 *
 * - `url === null` switches the feed off (no requests, no data).
 * - Data is keyed by URL, so switching products never shows the previous
 *   product's data under the new name — unless `keepPrevious` is set, which
 *   suits a feed where the old data is still true, just incomplete (reports
 *   for 3 days while 5 are loading).
 * - `whenHidden: false` pauses polling in a background tab and catches up on
 *   return. The alerts feed keeps polling so notifications still fire.
 * - The last good data is kept through a failed poll; the error rides along.
 * - `refreshToken` changing forces an immediate poll (the Refresh button).
 */

export interface Feed<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Unix ms of the last successful poll. */
  updatedAt: number | null;
}

interface State<T> {
  key: string | null;
  data: T | null;
  error: string | null;
  inFlight: boolean;
  updatedAt: number | null;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    // Not JSON — fall through.
  }
  return `The server answered ${response.status}.`;
}

export function usePoll<T>(
  url: string | null,
  intervalMs: number,
  options: { whenHidden: boolean; keepPrevious?: boolean; refreshToken: number },
): Feed<T> {
  const { whenHidden, keepPrevious = false, refreshToken } = options;
  const [state, setState] = useState<State<T>>({
    key: null,
    data: null,
    error: null,
    inFlight: false,
    updatedAt: null,
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let controller: AbortController | null = null;
    let lastPoll = 0;

    const poll = async () => {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      lastPoll = Date.now();
      setState((s) => ({ ...s, inFlight: true }));
      try {
        const response = await fetch(url, { signal: mine.signal, cache: "no-store" });
        if (!response.ok) throw new Error(await readError(response));
        const data = (await response.json()) as T;
        if (cancelled || mine.signal.aborted) return;
        setState({ key: url, data, error: null, inFlight: false, updatedAt: Date.now() });
      } catch (error) {
        if (cancelled || mine.signal.aborted) return;
        const message =
          error instanceof TypeError ? "Can't reach the Outside server." : (error as Error).message;
        setState((s) => ({ ...s, error: message, inFlight: false }));
      }
    };

    const tick = () => {
      if (!whenHidden && document.hidden) return;
      void poll();
    };

    // Coming back to a tab that sat hidden past its interval: catch up now.
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastPoll >= intervalMs) void poll();
    };

    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      controller?.abort();
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url, intervalMs, whenHidden, refreshToken]);

  if (!url) return { data: null, error: null, loading: false, updatedAt: null };
  const current = state.key === url;
  const data = current || keepPrevious ? state.data : null;
  return {
    data,
    error: state.error,
    loading: state.inFlight || !current,
    updatedAt: current ? state.updatedAt : null,
  };
}
