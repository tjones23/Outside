import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { contentSecurityPolicy, staticSecurityHeaders } from "./security-headers";
import { THEME_SCRIPT } from "./theme";

const NONCE = "dGVzdC1ub25jZQ==";
const policy = (isDev = false) => contentSecurityPolicy({ nonce: NONCE, isDev });
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(name));

describe("contentSecurityPolicy", () => {
  it("nonces scripts and never allows inline script", () => {
    const scriptSrc = directive(policy(), "script-src");
    expect(scriptSrc).toContain(`'nonce-${NONCE}'`);
    expect(scriptSrc).not.toContain("unsafe-inline");
    expect(scriptSrc).not.toContain("strict-dynamic");
  });

  it("allows the inline theme script by its hash", () => {
    const hash = createHash("sha256").update(THEME_SCRIPT).digest("base64");
    expect(directive(policy(), "script-src")).toContain(`'sha256-${hash}'`);
  });

  it("allows eval only in development", () => {
    expect(policy(true)).toContain("'unsafe-eval'");
    expect(policy(false)).not.toContain("'unsafe-eval'");
  });

  it("lets the map fetch from its tile hosts, and nothing else remote", () => {
    expect(directive(policy(), "connect-src")).toBe(
      "connect-src 'self' https://mesonet.agron.iastate.edu https://tiles.openfreemap.org https://s3.amazonaws.com",
    );
    expect(directive(policy(), "img-src")).toBe("img-src 'self' blob: data: https://digital.weather.gov");
  });

  it("allows server-rendered style attributes but still nonces style elements", () => {
    expect(directive(policy(), "style-src-attr")).toBe("style-src-attr 'unsafe-inline'");
    expect(directive(policy(), "style-src ")).toContain(`'nonce-${NONCE}'`);
  });

  it("lets the development overlay's style elements through, but only in development", () => {
    expect(directive(policy(true), "style-src ")).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(policy(false), "style-src ")).toContain("'nonce-");
  });

  it("allows the notification service worker", () => {
    expect(policy()).toContain("worker-src 'self'");
  });

  it("never upgrades or pins HTTPS, since the LAN address is plain HTTP", () => {
    expect(policy()).not.toContain("upgrade-insecure-requests");
    expect(staticSecurityHeaders()).not.toHaveProperty("Strict-Transport-Security");
  });

  it("forbids framing", () => {
    expect(policy()).toContain("frame-ancestors 'none'");
    expect(staticSecurityHeaders()["X-Frame-Options"]).toBe("DENY");
  });
});

describe("staticSecurityHeaders", () => {
  it("allows geolocation for this origin only", () => {
    expect(staticSecurityHeaders()["Permissions-Policy"]).toContain("geolocation=(self)");
  });
});
