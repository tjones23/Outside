import { connection, type NextRequest } from "next/server";
import { parseCoord } from "@/lib/point-forecast";
import { getSnowBlend } from "@/lib/sources/cached";
import { badRequest, busy, respond, visitorKey } from "@/lib/sources/respond";
import { snowBlendAllowed } from "@/lib/sources/upstream";

/** A saved place's 15-day snow blend across models: `?lat=40.588&lon=-111.638`. */
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const coord = parseCoord(params.get("lat"), params.get("lon"));
  if (!coord) return badRequest("lat and lon must be valid coordinates.");
  if (!snowBlendAllowed(visitorKey(request))) {
    return busy("Too many snow forecast lookups from here recently — try again in a few minutes.");
  }
  return respond("the snow forecast", await getSnowBlend(coord.lat, coord.lon, Date.now()), (data) => data, request);
}
