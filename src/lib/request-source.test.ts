import { describe, expect, it } from "vitest";
import { relyingParty, requestSource } from "./request-source";

const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null;

describe("requestSource", () => {
  it("trusts the tailnet identity serve stamps on", () => {
    expect(
      requestSource(headers({ "tailscale-user-login": " Alex@Example.com ", host: "outside.example.ts.net", "x-forwarded-for": "100.64.0.2" })),
    ).toEqual({ via: "tailnet", login: "alex@example.com" });
  });

  it("calls a loopback request from this Mac local", () => {
    expect(requestSource(headers({ host: "localhost:3001", "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "localhost:3001" }))).toEqual({
      via: "local",
    });
    expect(requestSource(headers({ host: "[::1]:3001" }))).toEqual({ via: "local" });
  });

  it("calls Funnel and LAN requests other", () => {
    // Funnel: the public name and the visitor's address, no identity.
    expect(requestSource(headers({ host: "outside.example.ts.net", "x-forwarded-for": "203.0.113.9" }))).toEqual({ via: "other" });
    // LAN: this Mac's network address.
    expect(requestSource(headers({ host: "192.168.1.20:3001", "x-forwarded-for": "192.168.1.30" }))).toEqual({ via: "other" });
    // A loopback Host with a forwarded visitor isn't from this Mac.
    expect(requestSource(headers({ host: "localhost:3001", "x-forwarded-for": "127.0.0.1, 203.0.113.9" }))).toEqual({ via: "other" });
    expect(requestSource(headers({ host: "localhost:3001", "x-forwarded-host": "outside.example.ts.net" }))).toEqual({ via: "other" });
    expect(requestSource(headers({ host: "localhost:3001", forwarded: "for=203.0.113.9" }))).toEqual({ via: "other" });
  });
});

describe("relyingParty", () => {
  it("is the host the browser is on, behind serve", () => {
    expect(relyingParty(headers({ host: "127.0.0.1:3001", "x-forwarded-host": "outside.example.ts.net", "x-forwarded-proto": "https" }))).toEqual({
      id: "outside.example.ts.net",
      origin: "https://outside.example.ts.net",
    });
  });

  it("keeps the port in the origin but not the id", () => {
    expect(relyingParty(headers({ host: "localhost:3001" }))).toEqual({ id: "localhost", origin: "http://localhost:3001" });
  });
});
