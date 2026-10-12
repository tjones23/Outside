import { connection } from "next/server";
import { getSmoke } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** NOAA HMS smoke plumes for today (UTC), or yesterday until today's are drawn. */
export async function GET(request: Request) {
  await connection();
  return respond("smoke", await getSmoke(new Date()), (data) => data, request);
}
