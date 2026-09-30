"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";
import { readThemePreference, subscribeThemePreference } from "@/lib/client-store";
import { resolveTheme, SYSTEM_LIGHT_QUERY, THEME_COLOR, type Theme } from "@/lib/theme";

function systemQuery(): MediaQueryList {
  return window.matchMedia(SYSTEM_LIGHT_QUERY);
}

/** Fires when the stored preference or the device's own setting changes. */
function subscribe(onChange: () => void): () => void {
  const query = systemQuery();
  query.addEventListener("change", onChange);
  const unsubscribe = subscribeThemePreference(onChange);
  return () => {
    query.removeEventListener("change", onChange);
    unsubscribe();
  };
}

function readTheme(): Theme {
  return resolveTheme(readThemePreference(), systemQuery().matches);
}

/** The theme on screen right now. Dark on the server, like the page's default. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => "dark");
}

function applyTheme(): void {
  const preference = readThemePreference();
  const theme = resolveTheme(preference, systemQuery().matches);
  document.documentElement.setAttribute("data-theme", theme);
  // The layout declares one theme-color per system scheme. Following the
  // system, each keeps its own; with a fixed choice, both show that theme.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own: Theme = meta.media.includes("light") ? "light" : "dark";
    meta.content = THEME_COLOR[preference === "system" ? own : theme];
  }
}

/**
 * Keeps <html data-theme> current: when the setting changes, in this tab or
 * another, and when the device switches between light and dark — no reload.
 *
 * It applies the theme straight from its sources rather than through
 * `useTheme`, whose server snapshot would briefly put a light page back to
 * dark while hydrating. A layout effect, so it also runs before paint after
 * React's development remount clears the attribute the head script set.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    applyTheme();
    return subscribe(applyTheme);
  }, []);
  return null;
}
