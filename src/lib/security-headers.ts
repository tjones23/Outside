import { createHash } from "node:crypto";
import { THEME_SCRIPT } from "./theme";

/**
 * Response security headers, adapted from WhatsGood.
 *
 * Built here rather than in `next.config.ts` because the Content-Security-Policy
 * carries a per-request nonce, which a static config can't produce.
 *
 * Unlike WhatsGood there is no HTTPS switch: one `next start` process answers
 * both the plain-HTTP LAN address and the HTTPS tailnet address at once, so
 * `Strict-Transport-Security` and `upgrade-insecure-requests` would be wrong
 * for one of them no matter how they were set — and HSTS on the LAN address
 * would lock that address out for as long as the browser remembers it.
 */

export interface HeaderOptions {
  /** Per-request nonce, base64. */
  nonce: string;
  /** Development needs `unsafe-eval`; React uses it for better error stacks. */
  isDev: boolean;
}

/**
 * Hosts the browser loads map imagery from. Everything else — including all
 * storm data, which the server fetches and caches — is same-origin.
 */
export const TILE_HOSTS = [
  // Basemaps and their labels (Esri Dark Gray and Light Gray Canvas).
  "https://server.arcgisonline.com",
  // HRRR future-radar frames (Iowa Environmental Mesonet).
  "https://mesonet.agron.iastate.edu",
  // NWS forecast (NDFD) frames and their color-scale legends.
  "https://digital.weather.gov",
] as const;

/**
 * React's streaming renderer puts one fixed inline script in the prerendered
 * shell — `requestAnimationFrame(function(){$RT=performance.now()})`, a timing
 * mark for revealing Suspense boundaries. It is emitted before any nonce
 * exists, so it is allowed by its hash. Should a React upgrade change it, the
 * browser just blocks the timing mark; nothing breaks.
 */
const REACT_TIMING_HASH = "'sha256-7mu4H06fwDCjmnxxr/xNHyuQC6pLTHr4M2E4jXw5WZs='";

/**
 * The layout's inline theme script, which has to run before the first paint.
 * The prerendered shell it lives in has no nonce, so it too is allowed by its
 * hash — computed from the script itself, so the two can't drift apart.
 */
const THEME_SCRIPT_HASH = `'sha256-${createHash("sha256").update(THEME_SCRIPT).digest("base64")}'`;

export function contentSecurityPolicy({ nonce, isDev }: HeaderOptions): string {
  return [
    "default-src 'self'",
    /*
     * Deliberately without `'strict-dynamic'`: it makes browsers ignore
     * `'self'`, so every script tag would need a nonce — which a prerendered
     * route can't have, because its HTML is built before any nonce exists.
     * `'self'` plus a nonce still blocks injected inline script.
     */
    `script-src 'self' 'nonce-${nonce}' ${REACT_TIMING_HASH} ${THEME_SCRIPT_HASH}${isDev ? " 'unsafe-eval'" : ""}`,
    /*
     * In development, Next's dev overlay injects un-nonced `<style>` elements;
     * with a nonce present they'd be blocked (a few dozen console errors per
     * load, and an unstyled overlay). Dropping the nonce lets `'unsafe-inline'`
     * apply. Production keeps the nonce.
     */
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    /*
     * Style *attributes* — the category and alert colors on chips, banners
     * and legend swatches, rendered on the server. A nonce can't apply to an
     * attribute, and with a nonce present browsers ignore `'unsafe-inline'`
     * in style-src, so attributes get their own directive. Inline styles
     * can't run script; `<style>` elements still need the nonce.
     */
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${TILE_HOSTS.join(" ")}`,
    "font-src 'self'",
    "connect-src 'self'",
    // The notification service worker.
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Nothing may embed this site — the clickjacking defence.
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Headers that don't depend on a nonce. */
export function staticSecurityHeaders(): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    // Leak nothing to the sites we link out to — not even this server's name.
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    // Location is the one sensor this app uses, and only for itself.
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  };
}
