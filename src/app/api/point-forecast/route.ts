import { connection, type NextRequest } from "next/server";
import { parseCoord } from "@/lib/point-forecast";
import { getPointForecast } from "@/lib/sources/cached";
import { badRequest, busy, respond, visitorKey } from "@/lib/sources/respond";
import { pointForecastAllowed } from "@/lib/sources/upstream";

/** A saved place's 7-day NWS forecast: `?lat=40.588&lon=-111.638`. */
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const coord = parseCoord(params.get("lat"), params.get("lon"));
  if (!coord) return badRequest("lat and lon must be valid coordinates.");
  if (!pointForecastAllowed(visitorKey(request))) {
    return busy("Too many forecast lookups from here recently — try again in a few minutes.");
  }
  return respond("the forecast", await getPointForecast(coord.lat, coord.lon, Date.now()), (data) => data, request);
}
