import { connection, type NextRequest } from "next/server";
import { parseCoord, parseFeet } from "@/lib/point-forecast";
import type { BandRequest } from "@/lib/snow-blend";
import { getSnowBlend } from "@/lib/sources/cached";
import { badRequest, busy, respond, visitorKey } from "@/lib/sources/respond";
import { snowBlendAllowed } from "@/lib/sources/upstream";

/** A band closer than this to the blend's own height says nothing new. */
const MIN_BAND_GAP_FT = 300;

/**
 * A saved place's 15-day snow blend across models: `?lat=40.588&lon=-111.638`,
 * plus for a resort `&elev=9500` (feet, its mid-mountain) and `&base=` and
 * `&top=` to work it out at the base and summit too.
 */
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const coord = parseCoord(params.get("lat"), params.get("lon"));
  if (!coord) return badRequest("lat and lon must be valid coordinates.");
  const elev = parseFeet(params.get("elev"));
  const base = parseFeet(params.get("base"));
  const top = parseFeet(params.get("top"));
  if (elev === undefined || base === undefined || top === undefined) {
    return badRequest("elev, base and top must be heights in feet.");
  }
  const bands: BandRequest[] =
    elev === null
      ? []
      : [
          { label: "Base", elevationFt: base },
          { label: "Summit", elevationFt: top },
        ].filter((b): b is BandRequest => b.elevationFt !== null && Math.abs(b.elevationFt - elev) >= MIN_BAND_GAP_FT);
  if (!snowBlendAllowed(visitorKey(request))) {
    return busy("Too many snow forecast lookups from here recently — try again in a few minutes.");
  }
  return respond("the snow forecast", await getSnowBlend(coord.lat, coord.lon, elev, bands, Date.now()), (data) => data, request);
}
