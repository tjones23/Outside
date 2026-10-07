import { gzipSync } from "node:zlib";
import type { Fetched } from "./cached";

/**
 * Shared response helpers for the `/api/*` route handlers.
 *
 * `no-store` because the only cache layer is `use cache` on the server:
 * a browser or proxy holding its own copy would just make the map lag.
 */

const HEADERS = { "Cache-Control": "no-store" };

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400, headers: HEADERS });
}

export function busy(message: string): Response {
  return Response.json({ error: message }, { status: 429, headers: HEADERS });
}

/** Below this, gzip isn't worth the CPU. */
const GZIP_MIN_BYTES = 2048;

/**
 * JSON, gzipped when the browser takes it. `next start` compresses pages but
 * not route-handler responses, and the alerts feed — every NWS alert with its
 * outline — is over a megabyte of JSON polled once a minute; gzip makes it
 * about a fifth of that.
 */
function json(body: object, request: Request | undefined): Response {
  const text = JSON.stringify(body);
  const accepts = request?.headers.get("accept-encoding") ?? "";
  if (text.length < GZIP_MIN_BYTES || !/\bgzip\b/.test(accepts)) {
    return new Response(text, { headers: { ...HEADERS, "Content-Type": "application/json" } });
  }
  return new Response(new Uint8Array(gzipSync(text)), {
    headers: { ...HEADERS, "Content-Type": "application/json", "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
  });
}

/**
 * 200 with `shape(value)` on success; on an upstream failure, 502 with a
 * plain-language error for the page and the detail for the server log.
 * Pass the request to have a large body gzipped.
 */
export function respond<T>(what: string, result: Fetched<T>, shape: (value: T) => object, request?: Request): Response {
  if (result.ok) {
    return json({ ...shape(result.value), fetchedAt: Date.now() }, request);
  }
  console.error(`[outside] ${what} failed: ${result.error}`);
  return Response.json(
    { error: `Couldn't load ${what} right now.`, detail: result.error },
    { status: 502, headers: HEADERS },
  );
}
