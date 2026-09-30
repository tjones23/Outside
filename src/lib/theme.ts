/**
 * Light and dark themes.
 *
 * The preference is "system", "light" or "dark", kept in localStorage with
 * the rest of this browser's settings. What the page shows is always one of
 * the two themes, set as `data-theme` on <html>; globals.css swaps its color
 * tokens on that attribute.
 *
 * Two pieces keep the attribute right: `THEME_SCRIPT`, inline in <head>, sets
 * it before the first paint so a light page never flashes dark; after that,
 * `ThemeSync` follows the preference and the system setting as they change.
 */

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

export const THEME_STORAGE_KEY = "outside:theme:v1";

/** Without a stored choice, follow the device. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

export const SYSTEM_LIGHT_QUERY = "(prefers-color-scheme: light)";

/** Browser chrome (`theme-color`) for each theme — the page's `--ink`. */
export const THEME_COLOR: Record<Theme, string> = {
  dark: "#08080b",
  light: "#f5f5f7",
};

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): Theme {
  if (preference === "system") return systemPrefersLight ? "light" : "dark";
  return preference;
}

/**
 * Runs while <head> is parsed, before anything is painted. Kept to plain ES5
 * and wrapped so a blocked localStorage can't stop the page. The CSP allows
 * it by hash (see security-headers.ts), so it must stay a fixed string.
 */
export const THEME_SCRIPT = `(function(){var p;try{p=JSON.parse(localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)}))}catch(e){}var t=p==="light"||p==="dark"?p:window.matchMedia&&matchMedia(${JSON.stringify(
  SYSTEM_LIGHT_QUERY,
)}).matches?"light":"dark";document.documentElement.setAttribute("data-theme",t)})()`;
