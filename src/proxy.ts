import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, staticSecurityHeaders } from "@/lib/security-headers";

/**
 * Security headers on every response.
 *
 * (In Next 16 this file is `proxy.ts`; `middleware.ts` is the deprecated name.)
 * There is no sign-in: the app is reachable only on the local network and the
 * tailnet, and it holds nothing but public weather data — everything personal
 * (saved places, settings) stays in each browser.
 */

/** A fresh nonce per request, so an injected script can't guess it. */
function makeNonce(): string {
  return Buffer.from(crypto.randomUUID()).toString("base64");
}

export function proxy(request: NextRequest) {
  const nonce = makeNonce();
  const csp = contentSecurityPolicy({
    nonce,
    isDev: process.env.NODE_ENV === "development",
  });

  // Pass the nonce through on the request so Next stamps it onto the script
  // tags it renders; without it the page's own bootstrap would be blocked.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  for (const [key, value] of Object.entries(staticSecurityHeaders())) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
