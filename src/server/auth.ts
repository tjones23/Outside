import "server-only";
import { cookies, headers } from "next/headers";
import { accountsDb } from "./context";
import { cookieMaxAgeSeconds, findSession, type Session, type User } from "./accounts";
import { createRateLimiterState, recordHit } from "@/lib/rate-limit";
import { isLoopbackHost, relyingParty, requestSource, sourceKey, type RelyingParty, type RequestSource } from "@/lib/request-source";

/**
 * The only place that reads the session cookie. Every Server Action that
 * touches an account calls `currentUser()` itself — an action is a public
 * endpoint whatever page it was rendered on, so none trusts the client's
 * word about who's signed in.
 *
 * Pages never read it: Outside's pages are static shells that fetch
 * everything from the browser, and the account is no different
 * (AccountProvider asks for it once the page is up).
 */

export const SESSION_COOKIE = "outside_session";

export interface RequestInfo {
  source: RequestSource;
  https: boolean;
  /** Passkeys need a secure page: HTTPS, or this Mac's own localhost. */
  secure: boolean;
  userAgent: string | null;
  relyingParty: RelyingParty;
  /** Who's asking, for rate limits: a tailnet login, or the connecting address. */
  sourceKey: string;
}

export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const get = (name: string) => h.get(name);
  const https = get("x-forwarded-proto") === "https";
  const rp = relyingParty(get);
  const source = requestSource(get);
  return {
    source,
    https,
    secure: https || isLoopbackHost(rp.id),
    userAgent: get("user-agent"),
    relyingParty: rp,
    sourceKey: sourceKey(source, get),
  };
}

/**
 * Who may make an account: anyone reaching Outside from the tailnet or from
 * this Mac. Not over Funnel — a public link shouldn't let strangers fill the
 * database — though an existing account signs in from anywhere.
 */
export function canSignUp(request: RequestInfo): boolean {
  return request.secure && request.source.via !== "other";
}

export interface Current {
  session: Session;
  user: User;
  request: RequestInfo;
}

/** The signed-in session, or null. */
export async function currentUser(): Promise<Current | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const found = findSession(accountsDb(), token, Date.now());
  return found ? { ...found, request: await requestInfo() } : null;
}

/** Only in a Server Action or Route Handler — cookies can't be set mid-render. */
export async function setSessionCookie(token: string, https: boolean) {
  const now = Date.now();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Lax, not Strict: opening Outside from a link elsewhere still arrives signed in.
    // Every account change goes through a Server Action, which Next only
    // accepts from this same origin.
    sameSite: "lax",
    // Over the tailnet it's HTTPS; on this Mac it's plain http://localhost.
    secure: https,
    path: "/",
    maxAge: cookieMaxAgeSeconds({ createdAt: now, lastSeenAt: now }, now),
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

// ---------------------------------------------------------------------------
// Rate limits. In memory: one server process, and a restart forgetting them
// costs an attacker a restart they can't cause.
// ---------------------------------------------------------------------------

const limiter = createRateLimiterState();
const WINDOW_MS = 15 * 60_000;

/**
 * False once this source has tried too often lately: a tailnet login, or for
 * anyone else their address, so one Funnel visitor can't lock out the rest.
 */
export function allowAttempt(kind: "sign-in" | "sign-up" | "add-passkey", request: RequestInfo): boolean {
  const source = request.sourceKey;
  const max = kind === "sign-in" ? 30 : 10;
  return recordHit(limiter, `${kind}:${source}`, Date.now(), WINDOW_MS, max);
}
