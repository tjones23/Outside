import { connection } from "next/server";
import { FORECAST_PRODUCTS, NDFD_LAYERS, ndfdValidTime } from "@/lib/forecast";
import { fetchNdfdTile } from "@/lib/sources/upstream";

/**
 * One NWS forecast (NDFD) tile: `/api/ndfd/ndfd.conus.t/2026-10-07T1800/5/8/11.png`.
 *
 * The map fetches its tiles, and NWS's WMS sends no CORS headers, so this
 * route asks for the tile instead and passes it on. Only the forecast layers
 * Outside shows, at the zooms it draws them, are asked for.
 */

const INT = /^\d{1,7}$/;
const MAX_ZOOM = Math.max(...FORECAST_PRODUCTS.map((p) => p.maxNativeZoom));

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ layer: string; time: string; z: string; x: string; y: string }> },
) {
  await connection();
  const { layer, time, z, x, y } = await params;
  const yNum = y.replace(/\.png$/, "");
  const validTime = ndfdValidTime(time);
  if (!NDFD_LAYERS.has(layer) || !validTime || ![z, x, yNum].every((part) => INT.test(part))) {
    return new Response(null, { status: 404 });
  }
  const [zoom, col, row] = [Number(z), Number(x), Number(yNum)];
  if (zoom > MAX_ZOOM || col >= 2 ** zoom || row >= 2 ** zoom) return new Response(null, { status: 404 });

  try {
    const tile = await fetchNdfdTile(layer, validTime, zoom, col, row);
    // NWS updates a valid time's grid as it reissues the forecast, so not for long.
    return new Response(new Uint8Array(tile), {
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=600" },
    });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
