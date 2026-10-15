import { connection, type NextRequest } from "next/server";
import { getSnowDepths } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** Every SNOTEL station's latest snow depth, for the resort lists. One shared cache entry. */
export async function GET(request: NextRequest) {
  await connection();
  return respond("snow depths", await getSnowDepths(), (stations) => ({ stations }), request);
}
