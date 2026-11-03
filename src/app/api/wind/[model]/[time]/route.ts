import { connection, type NextRequest } from "next/server";
import { readFrame } from "@/lib/sources/wind-store";
import { isWindModel } from "@/lib/wind";

/**
 * One wind frame: `/api/wind/gfs/1793664000.png?run=1793642400`.
 *
 * A frame never changes once drawn — a newer run's is a different file — so
 * it's cached hard. One that's gone (aged out, or replaced by a newer run)
 * is a 404 until the next manifest poll.
 */

const TIME = /^\d{10}$/;

export async function GET(request: NextRequest, { params }: { params: Promise<{ model: string; time: string }> }) {
  await connection();
  const { model, time } = await params;
  const t = time.replace(/\.png$/, "");
  const run = request.nextUrl.searchParams.get("run") ?? "";
  if (!isWindModel(model) || !TIME.test(t) || !TIME.test(run)) return new Response(null, { status: 404 });

  const png = await readFrame(model, Number(t), Number(run));
  if (!png) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400, immutable" },
  });
}
