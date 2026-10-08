/**
 * A sliding-window request counter: has `key` already made more than `max`
 * calls in the last `windowMs`?
 *
 * Takes `now` rather than reading the clock itself, so it's deterministic to
 * test. Each call prunes `key`'s own history to the window before counting
 * it, so a quiet key's entry eventually disappears instead of growing
 * forever.
 */

export interface RateLimiterState {
  hits: Map<string, number[]>;
}

export function createRateLimiterState(): RateLimiterState {
  return { hits: new Map() };
}

/** Records one hit for `key` at `now`, and reports whether it's still within `max` for `windowMs`. */
export function recordHit(state: RateLimiterState, key: string, now: number, windowMs: number, max: number): boolean {
  const cutoff = now - windowMs;
  const recent = (state.hits.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  state.hits.set(key, recent);
  return recent.length <= max;
}
