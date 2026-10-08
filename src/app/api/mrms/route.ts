import { connection } from "next/server";
import { PRECIP_TYPE_ATTRIBUTION, precipTypeFrame } from "@/lib/precip-type";
import { availableFrames, nextFrame, refreshIfDue } from "@/lib/sources/mrms-store";
import { respond } from "@/lib/sources/respond";
import type { PrecipTypeManifest } from "@/lib/types";

/**
 * How long a poll waits for the first frame when none are drawn yet (first
 * view, or after a quiet spell) — long enough for one frame on an older Mac,
 * rather than answering with nothing and leaving the map blank until the next
 * poll.
 */
const FIRST_FRAME_WAIT_MS = 20_000;

/**
 * The rain-and-snow radar frames drawn so far. Each poll also lets the
 * server catch up on frames it hasn't drawn; the refresh outlives the
 * request and `pending` says it's still going.
 */
export async function GET() {
  await connection();
  let frames = await availableFrames(Date.now());
  let status = refreshIfDue(Date.now());
  if (frames.length === 0 && status.pending) {
    await nextFrame(FIRST_FRAME_WAIT_MS);
    frames = await availableFrames(Date.now());
    status = refreshIfDue(Date.now());
  }

  const result =
    frames.length === 0 && status.error ? ({ ok: false, error: status.error } as const) : ({ ok: true, value: null } as const);
  return respond("rain and snow radar", result, (): { manifest: PrecipTypeManifest } => ({
    manifest: { frames: frames.map(precipTypeFrame), pending: status.pending, attribution: PRECIP_TYPE_ATTRIBUTION },
  }));
}
