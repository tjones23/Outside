import { connection, type NextRequest } from "next/server";
import { normalizeQuery } from "@/lib/geocode";
import { getGeocode } from "@/lib/sources/cached";
import { badRequest, busy, respond } from "@/lib/sources/respond";
import { geocodeQueueFull } from "@/lib/sources/upstream";

/** Place search for saving a location: `?q=moore, ok`. */
export async function GET(request: NextRequest) {
  await connection();
  const query = normalizeQuery(request.nextUrl.searchParams.get("q"));
  if (!query) return badRequest("Enter a city, ZIP code or address.");
  if (geocodeQueueFull()) return busy("Too many place searches at once — try again in a moment.");
  return respond("place search", await getGeocode(query), (results) => ({ results }));
}
