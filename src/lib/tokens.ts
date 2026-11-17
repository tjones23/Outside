import { createHash, randomBytes } from "node:crypto";

/**
 * Random bearer values — session cookies, challenge ids — and how they're
 * stored. Each is 256 bits, so a plain SHA-256 is enough to keep the
 * database from holding anything usable.
 */

/** 256 bits, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
