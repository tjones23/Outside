import { connection } from "next/server";
import { getAlerts } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** Active NWS tornado and severe-thunderstorm warnings and watches. */
export async function GET() {
  // Without this Next would prerender the route at build time — fetching
  // alerts once during `next build` and serving that snapshot forever.
  await connection();
  return respond("warnings", await getAlerts(), (alerts) => ({ alerts }));
}
