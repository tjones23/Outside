import type { GeocodeResult } from "./types";

/**
 * Place search, via OpenStreetMap's Nominatim.
 *
 * Chosen over the Census geocoder because people save places by city or ZIP
 * ("Moore, OK", "73160") far more often than by street address, and the
 * Census service only resolves street addresses. Nominatim's usage policy —
 * at most one request a second, an identifying User-Agent, results cached,
 * no search-as-you-type — is met in `sources/nominatim.ts` and by searching
 * only on submit.
 */

export const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

const MAX_QUERY = 200;
export const MAX_RESULTS = 8;

/** Trimmed, whitespace-collapsed, lower-cased — so equal queries share a cache entry. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (q.length < 2 || q.length > MAX_QUERY) return null;
  return q;
}

export function nominatimUrl(query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: String(MAX_RESULTS),
    // SPC and NWS cover the US only, so a match elsewhere is never useful.
    countrycodes: "us",
  });
  return `${NOMINATIM_SEARCH_URL}?${params}`;
}

/** Nominatim results → short names plus coordinates. */
export function parseNominatim(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) return [];
  const out: GeocodeResult[] = [];
  for (const item of json) {
    const r = item as Record<string, unknown>;
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const detail = typeof r.display_name === "string" ? r.display_name : "";
    const a = (r.address ?? {}) as Record<string, unknown>;
    const s = (key: string) => (typeof a[key] === "string" ? (a[key] as string) : null);

    const place =
      s("city") ?? s("town") ?? s("village") ?? s("hamlet") ?? s("suburb") ?? s("county");
    const street = s("road") ? [s("house_number"), s("road")].filter(Boolean).join(" ") : null;
    const lead = street ?? (typeof r.name === "string" && r.name ? r.name : null) ?? place;
    const parts = [lead, lead !== place ? place : null, s("state")].filter(
      (p): p is string => Boolean(p),
    );

    out.push({
      name: parts.length > 0 ? parts.join(", ") : detail.split(",").slice(0, 2).join(",").trim(),
      detail,
      lat,
      lon,
    });
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}
