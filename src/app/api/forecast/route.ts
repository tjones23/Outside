import { connection, type NextRequest } from "next/server";
import { FORECAST_PRODUCTS, isForecastProduct } from "@/lib/forecast";
import { getForecast } from "@/lib/sources/cached";
import { badRequest, respond } from "@/lib/sources/respond";

/** One forecast animation's frames: `?product=hrrr-refd`. */
export async function GET(request: NextRequest) {
  await connection();
  const product = request.nextUrl.searchParams.get("product");
  if (!isForecastProduct(product)) {
    return badRequest(`product must be one of ${FORECAST_PRODUCTS.map((p) => p.id).join(", ")}`);
  }
  return respond("the forecast", await getForecast(product, Date.now()), (data) => data, request);
}
