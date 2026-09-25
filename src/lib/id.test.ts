import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes a v4 UUID", () => {
    expect(newId()).toMatch(UUID);
  });

  it("still works without randomUUID, as on a plain-HTTP page", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array) => real.getRandomValues(a),
    });
    const a = newId();
    const b = newId();
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
