import { connection } from "next/server";
import { getHotspots } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** VIIRS satellite fire detections over North America, the last 24 hours. */
export async function GET(request: Request) {
  await connection();
  return respond("satellite hotspots", await getHotspots(), (hotspots) => ({ hotspots }), request);
}
