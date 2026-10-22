import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * MapLibre's tile worker, for the Explore basemap.
 *
 * MapLibre loads its worker from a file beside its own script, which a bundle
 * doesn't have. It is served from here instead — same-origin, so the
 * `worker-src 'self'` policy covers it — and `explore.tsx` points MapLibre at
 * it. The file is self-contained and read once, at build time.
 */
export async function GET() {
  const worker = await readFile(join(process.cwd(), "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs"));
  return new Response(worker, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
