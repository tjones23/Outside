import { connection } from "next/server";
import { PRECIP_TYPE_MAX_NATIVE_ZOOM, PRECIP_TYPE_MIN_ZOOM } from "@/lib/precip-type";
import { EMPTY_TILE, readTile } from "@/lib/sources/mrms-store";

/**
 * One rain-and-snow radar tile: `/api/mrms/1791423600/5/8/11.png`.
 *
 * A frame never changes once drawn, so tiles are cached hard. Clear spots in
 * a frame get an empty tile rather than a 404, so the browser has nothing to
 * log and the frame preloader nothing to wait on.
 */

const INT = /^\d{1,10}$/;

function png(body: Uint8Array): Response {
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ time: string; z: string; x: string; y: string }> },
) {
  await connection();
  const { time, z, x, y } = await params;
  const yNum = y.replace(/\.png$/, "");
  if (![time, z, x, yNum].every((part) => INT.test(part))) return new Response(null, { status: 404 });

  const zoom = Number(z);
  if (zoom < PRECIP_TYPE_MIN_ZOOM || zoom > PRECIP_TYPE_MAX_NATIVE_ZOOM) return png(EMPTY_TILE);

  const tile = await readTile(Number(time), zoom, Number(x), Number(yNum));
  if (tile === null) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return png(tile === "empty" ? EMPTY_TILE : tile);
}
