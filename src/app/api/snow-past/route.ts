import { connection, type NextRequest } from "next/server";
import { parseCoord, parseFeet } from "@/lib/point-forecast";
import { getSnowPast } from "@/lib/sources/cached";
import { badRequest, busy, respond, visitorKey } from "@/lib/sources/respond";
import { snowPastAllowed } from "@/lib/sources/upstream";

/**
 * A place's last 15 days of snow, modeled and measured:
 * `?lat=40.588&lon=-111.638`, plus `&elev=9500` (feet) for a resort, to work
 * the models out at its mid-mountain and pick the SNOTEL station nearest it.
 */
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const coord = parseCoord(params.get("lat"), params.get("lon"));
  if (!coord) return badRequest("lat and lon must be valid coordinates.");
  const elev = parseFeet(params.get("elev"));
  if (elev === undefined) return badRequest("elev must be a height in feet.");
  if (!snowPastAllowed(visitorKey(request))) {
    return busy("Too many past snow lookups from here recently — try again in a few minutes.");
  }
  const result = await getSnowPast(coord.lat, coord.lon, elev, Date.now());
  return respond("past snow", result, (data) => data, request);
}
