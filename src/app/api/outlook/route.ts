import { connection, type NextRequest } from "next/server";
import { availableDays, isOutlookKind, outlookProduct } from "@/lib/outlook";
import { getOutlook } from "@/lib/sources/cached";
import { badRequest, respond } from "@/lib/sources/respond";

/** One SPC convective outlook product: `?day=1&kind=categorical`. */
export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;
  const kind = params.get("kind");
  const day = Number(params.get("day") ?? "1");
  if (!isOutlookKind(kind)) {
    return badRequest("kind must be categorical, tornado, wind or hail");
  }
  if (!availableDays(kind).includes(day)) {
    return badRequest(`SPC publishes the ${kind} outlook for days ${availableDays(kind).join(", ")}`);
  }
  return respond("the SPC outlook", await getOutlook(outlookProduct(day, kind)), (data) => data);
}
