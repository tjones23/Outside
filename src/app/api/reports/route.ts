import { connection, type NextRequest } from "next/server";
import { getRecentReports } from "@/lib/sources/cached";
import { badRequest, respond } from "@/lib/sources/respond";

/** SPC storm reports for the last `days` (1–5) convective days. */
export async function GET(request: NextRequest) {
  await connection();
  const days = Number(request.nextUrl.searchParams.get("days") ?? "3");
  if (!Number.isInteger(days) || days < 1 || days > 5) {
    return badRequest("days must be a whole number from 1 to 5");
  }
  return respond("storm reports", await getRecentReports(days, new Date()), (data) => data, request);
}
