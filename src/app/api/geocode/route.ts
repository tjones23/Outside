import { connection, type NextRequest } from "next/server";
import { normalizeQuery } from "@/lib/geocode";
import { getGeocode } from "@/lib/sources/cached";
import { badRequest, busy, respond } from "@/lib/sources/respond";
import { geocodeAllowed, geocodeQueueFull } from "@/lib/sources/upstream";

/**
 * The caller's address, for the per-visitor limit below. Tailscale's proxy
 * (serve or Funnel) sets this to the connecting IP; a request that somehow
 * arrives without it is still counted, just all under one shared key.
 */
function visitorKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

/** Place search for saving a location: `?q=moore, ok`. */
export async function GET(request: NextRequest) {
  await connection();
  const query = normalizeQuery(request.nextUrl.searchParams.get("q"));
  if (!query) return badRequest("Enter a city, ZIP code or address.");
  if (!geocodeAllowed(visitorKey(request))) {
    return busy("Too many place searches from here recently — try again in a few minutes.");
  }
  if (geocodeQueueFull()) return busy("Too many place searches at once — try again in a moment.");
  return respond("place search", await getGeocode(query), (results) => ({ results }));
}
