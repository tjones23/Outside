import { connection, type NextRequest } from "next/server";
import { badRequest, respond } from "@/lib/sources/respond";
import { availableFrames, nextFrame, refreshIfDue } from "@/lib/sources/wind-store";
import type { WindManifest } from "@/lib/types";
import { imageGrid, isWindModel, WIND_ATTRIBUTION, windModel } from "@/lib/wind";

/**
 * How long a poll waits for the first frame when none are drawn yet — long
 * enough for one HRRR hour through the NOMADS filter, rather than answering
 * with nothing until the next poll.
 */
const FIRST_FRAME_WAIT_MS = 20_000;

/**
 * One model's wind frames drawn so far: `?model=gfs` or `?model=hrrr`. Each
 * poll also lets the server catch up on a newer run; the refresh outlives the
 * request and `pending` says it's still going.
 */
export async function GET(request: NextRequest) {
  await connection();
  const model = request.nextUrl.searchParams.get("model");
  if (!isWindModel(model)) return badRequest("model must be gfs or hrrr");

  let frames = await availableFrames(model, Date.now());
  let status = refreshIfDue(model, Date.now());
  if (frames.length === 0 && status.pending) {
    await nextFrame(model, FIRST_FRAME_WAIT_MS);
    frames = await availableFrames(model, Date.now());
    status = refreshIfDue(model, Date.now());
  }

  const result =
    frames.length === 0 && status.error ? ({ ok: false, error: status.error } as const) : ({ ok: true, value: null } as const);
  const { west, north, step, width, height } = imageGrid(windModel(model));
  return respond(
    `${windModel(model).name} wind`,
    result,
    (): { manifest: WindManifest } => ({
      manifest: { model, frames, grid: { west, north, step, width, height }, pending: status.pending, attribution: WIND_ATTRIBUTION },
    }),
    request,
  );
}
