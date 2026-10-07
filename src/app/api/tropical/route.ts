import { connection } from "next/server";
import { getTropical } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** NHC's active storms (forecast points, track, cone, coastal alerts, past track) and 7-day outlook. */
export async function GET(request: Request) {
  await connection();
  return respond("the tropical outlook", await getTropical(), (data) => data, request);
}
