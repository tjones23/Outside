import { describe, expect, it } from "vitest";
import { createRateLimiterState, recordHit } from "./rate-limit";

describe("recordHit", () => {
  it("allows up to max hits in the window", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 3; i++) {
      expect(recordHit(state, "a", i * 1000, 60_000, 3)).toBe(true);
    }
  });

  it("rejects once a key exceeds max within the window", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 3; i++) recordHit(state, "a", i * 1000, 60_000, 3);
    expect(recordHit(state, "a", 3000, 60_000, 3)).toBe(false);
  });

  it("tracks keys independently", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 3; i++) recordHit(state, "a", i * 1000, 60_000, 3);
    expect(recordHit(state, "b", 3000, 60_000, 3)).toBe(true);
  });

  it("forgets hits once they age out of the window", () => {
    const state = createRateLimiterState();
    for (let i = 0; i < 3; i++) recordHit(state, "a", i * 1000, 60_000, 3);
    expect(recordHit(state, "a", 61_000, 60_000, 3)).toBe(true);
  });
});
