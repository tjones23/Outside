/**
 * Where a request came from, as far as accounts care — decided from its
 * headers. Adapted from MoneyRight's network gate, but Outside turns nobody
 * away: the map is public weather. This only decides who may *create* an
 * account (see server/auth.ts).
 *
 *   - `tailnet`: through `tailscale serve` from a tailnet device. Serve stamps
 *     the sender's identity (`Tailscale-User-Login`, stripping any copy a
 *     client sends) when it can, and always the address that connected
 *     (X-Forwarded-For) — a Tailscale address for a tailnet device, a public
 *     one for a Funnel visitor.
 *   - `local`: straight from this Mac — a loopback Host, and loopback (or
 *     absent) X-Forwarded-For / X-Forwarded-Host.
 *   - `other`: everything else — Funnel visitors, and the plain-HTTP LAN
 *     address.
 *
 * One caveat. In `lan` mode `next start` listens on 0.0.0.0, so a device on
 * this network reaches the server directly, not through serve, and could
 * send a made-up `Tailscale-User-Login`. That's enough to make an account —
 * not to get into anyone else's, which takes their passkey. Tailnet-only and
 * this-Mac-only hosting don't have the gap.
 */

/** `login` is null when serve vouched for the address but sent no identity. */
export type RequestSource = { via: "tailnet"; login: string | null } | { via: "local" } | { via: "other" };

/** Lower-cased header lookup — `Headers.get` already is; tests pass a Map. */
export type HeaderGetter = (name: string) => string | null | undefined;

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(1, host.indexOf("]")) : host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

/**
 * Tailscale's own address ranges: 100.64.0.0/10 (IPv4 CGNAT space) and
 * fd7a:115c:a1e0::/48 (IPv6). A tailnet device always reaches serve from one;
 * a Funnel visitor never does — they come from the public internet.
 */
export function isTailscaleAddress(ip: string): boolean {
  const v4 = ip.replace(/^::ffff:/i, "");
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(v4);
  if (m) return Number(m[1]) === 100 && Number(m[2]) >= 64 && Number(m[2]) <= 127;
  return /^fd7a:115c:a1e0:/i.test(ip);
}

/**
 * The address that actually connected to serve: the right-most
 * X-Forwarded-For entry. Serve appends it, so anything to its left is
 * whatever the client chose to send.
 */
export function forwardedClient(forwardedFor: string | null | undefined): string | null {
  const entries = (forwardedFor ?? "").split(",").map((ip) => ip.trim()).filter(Boolean);
  return entries.at(-1) ?? null;
}

export function requestSource(header: HeaderGetter): RequestSource {
  const login = header("tailscale-user-login")?.trim().toLowerCase();
  if (login) return { via: "tailnet", login };

  // Serve doesn't always send the identity header (a tagged device, some
  // versions and setups), but it always says which address connected, and a
  // Funnel request is marked as one.
  const client = forwardedClient(header("x-forwarded-for"));
  if (client && isTailscaleAddress(client) && !header("tailscale-funnel-request")) {
    return { via: "tailnet", login: null };
  }

  if (!isLoopbackHost(header("host"))) return { via: "other" };
  const forwardedFor = header("x-forwarded-for");
  if (forwardedFor && !forwardedFor.split(",").every((ip) => LOOPBACK_ADDRESSES.has(ip.trim()))) return { via: "other" };
  const forwardedHost = header("x-forwarded-host");
  if (forwardedHost && !isLoopbackHost(forwardedHost)) return { via: "other" };
  if (header("forwarded")) return { via: "other" };
  return { via: "local" };
}

export interface RelyingParty {
  /** The bare hostname: "outside.example.ts.net", or "localhost". */
  id: string;
  /** Scheme, host and port the browser used. */
  origin: string;
}

/**
 * The host and origin the browser is on, for passkeys. Behind `tailscale
 * serve` that's https://outside.<tailnet>.ts.net, not this server's own
 * http://127.0.0.1:3001. Trusting the Host header is safe here: the browser
 * itself refuses to make or use a passkey for any host but the page's own.
 */
export function relyingParty(header: HeaderGetter): RelyingParty {
  const https = header("x-forwarded-proto") === "https";
  // Next fills X-Forwarded-Host from Host when nothing in front of it did.
  const host = header("x-forwarded-host") ?? header("host") ?? "localhost";
  return {
    id: host.replace(/:\d+$/, "").replace(/^\[|\]$/g, ""),
    origin: `${https ? "https" : "http"}://${host}`,
  };
}

/** For an event or an account record: "alex@example.com", or null on this Mac. */
export function sourceLogin(source: RequestSource): string | null {
  return source.via === "tailnet" ? source.login : null;
}

/** For rate limits: who's asking, as narrowly as the request lets us say. */
export function sourceKey(source: RequestSource, header: HeaderGetter): string {
  if (source.via === "tailnet" && source.login) return source.login;
  return `ip:${forwardedClient(header("x-forwarded-for")) ?? source.via}`;
}
