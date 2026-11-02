import { describe, expect, it } from "vitest";
import { carryOver, grow, restartFrom, single, startOf, step, type FrameWindow } from "./frame-window";

/** Every window `grow` passes through from `w`, as [lo, hi] pairs. */
function growth(w: FrameWindow, count: number, order: "newest-first" | "oldest-first"): [number, number][] {
  const out: [number, number][] = [];
  for (let next = grow(w, count, order); next; next = grow(next, count, order)) out.push([next.lo, next.hi]);
  return out;
}

describe("grow", () => {
  it("reaches back into the past first for radar", () => {
    expect(growth(single(startOf(4, "newest-first")), 4, "newest-first")).toEqual([
      [2, 3],
      [1, 3],
      [0, 3],
    ]);
  });

  it("reaches forward first for a forecast, then back from where it started", () => {
    expect(growth(single(2), 4, "oldest-first")).toEqual([
      [2, 3],
      [1, 3],
      [0, 3],
    ]);
  });

  it("marks the frame that just joined as the edge", () => {
    expect(grow(single(2), 4, "oldest-first")).toEqual({ lo: 2, hi: 3, edge: 3 });
    expect(grow({ lo: 2, hi: 3, edge: 3 }, 4, "oldest-first")).toEqual({ lo: 1, hi: 3, edge: 1 });
  });

  it("stops once every frame is mounted", () => {
    expect(grow({ lo: 0, hi: 3, edge: 0 }, 4, "newest-first")).toBeNull();
    expect(grow(single(0), 1, "oldest-first")).toBeNull();
  });
});

describe("step", () => {
  it("moves on and wraps from the end of the window to its start", () => {
    const w = { lo: 1, hi: 3, edge: 1 };
    expect([0, 1, 2, 3].map((i) => step(i, w))).toEqual([1, 2, 3, 1]);
  });
});

describe("carryOver", () => {
  it("keeps the mounted frames and the time on screen when a new frame arrives", () => {
    // 100…400 all mounted, showing 200; 100 ages out and 500 arrives.
    const next = carryOver([100, 200, 300, 400], { lo: 0, hi: 3, edge: 0 }, 1, [200, 300, 400, 500], "newest-first");
    expect(next).toEqual({ window: { lo: 0, hi: 2, edge: 2 }, index: 0 });
    // …and the new frame joins next.
    expect(grow(next.window, 4, "newest-first")).toEqual({ lo: 0, hi: 3, edge: 3 });
  });

  it("moves on to the oldest frame left when the one on screen ages out", () => {
    expect(carryOver([100, 200, 300], { lo: 0, hi: 2, edge: 0 }, 0, [200, 300, 400], "newest-first").index).toBe(0);
  });

  it("starts over when nothing it had mounted is left", () => {
    expect(carryOver([100, 200], { lo: 0, hi: 1, edge: 0 }, 1, [300, 400, 500], "newest-first")).toEqual({
      window: single(2),
      index: 2,
    });
    expect(carryOver([], single(0), 0, [300, 400], "newest-first")).toEqual({ window: single(1), index: 1 });
  });
});

describe("restartFrom", () => {
  it("keeps only the time on screen", () => {
    expect(restartFrom([100, 200, 300], 2, [200, 300, 400], "oldest-first")).toEqual({ window: single(1), index: 1 });
  });

  it("goes back to the start when that time is gone", () => {
    expect(restartFrom([100, 200], 0, [300, 400], "oldest-first")).toEqual({ window: single(0), index: 0 });
  });
});
