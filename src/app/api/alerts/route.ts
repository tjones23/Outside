import { connection } from "next/server";
import { getAlerts } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** Every active NWS warning, watch, advisory and statement, outlined where possible. */
export async function GET(request: Request) {
  // Without this Next would prerender the route at build time — fetching
  // alerts once during `next build` and serving that snapshot forever.
  await connection();
  return respond("alerts", await getAlerts(), (alerts) => ({ alerts }), request);
}
