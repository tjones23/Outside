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

/**
 * 200 with `shape(value)` on success; on an upstream failure, 502 with a
 * plain-language error for the page and the detail for the server log.
 */
export function respond<T>(what: string, result: Fetched<T>, shape: (value: T) => object): Response {
  if (result.ok) {
    return Response.json({ ...shape(result.value), fetchedAt: Date.now() }, { headers: HEADERS });
  }
  console.error(`[outside] ${what} failed: ${result.error}`);
  return Response.json(
    { error: `Couldn't load ${what} right now.`, detail: result.error },
    { status: 502, headers: HEADERS },
  );
}
