import { connection } from "next/server";
import { getFires } from "@/lib/sources/cached";
import { respond } from "@/lib/sources/respond";

/** Active wildfires (NIFC WFIGS) with their mapped perimeters. */
export async function GET(request: Request) {
  await connection();
  return respond("wildfires", await getFires(), (data) => data, request);
}
