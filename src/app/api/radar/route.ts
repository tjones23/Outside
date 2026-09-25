import { connection } from "next/server";
import { getRadar } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** The RainViewer frame list; `manifest` is null if RainViewer sent none. */
export async function GET() {
  await connection();
  return respond("radar", await getRadar(), (manifest) => ({ manifest }));
}
