import { describe, expect, it } from "vitest";
import { PRECIP_TYPE_RENDER_VERSION, precipTypeFrame } from "./precip-type";

describe("precipTypeFrame", () => {
  it("points at this server's tiles, versioned so a redraw isn't hidden by the browser cache", () => {
    expect(precipTypeFrame(1791423600)).toEqual({
      time: 1791423600,
      url: `/api/mrms/1791423600/{z}/{x}/{y}.png?v=${PRECIP_TYPE_RENDER_VERSION}`,
    });
  });
});
