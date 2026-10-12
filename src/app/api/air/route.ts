import { connection } from "next/server";
import { getAirQuality } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** EPA AirNow monitors' AQI for the newest published hour. */
export async function GET(request: Request) {
  await connection();
  return respond("air quality", await getAirQuality(new Date()), (data) => data, request);
}
