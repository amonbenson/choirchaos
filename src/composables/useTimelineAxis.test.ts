import { describe, expect, it, vi } from "vitest";
import { effectScope, shallowRef } from "vue";

import { type TimelineAxis, useTimelineAxis } from "./useTimelineAxis";

const WIDTH = 100;

vi.mock("@vueuse/core", async importOriginal => ({
  ...await importOriginal<typeof import("@vueuse/core")>(),
  useElementSize: () => ({ width: shallowRef(WIDTH), height: shallowRef(20) }),
}));

/** A song of 10000 ticks in units of 10 ticks, so fitting it to 100 pixels takes 10 units per pixel. */
function makeAxis(): TimelineAxis {
  const element = document.createElement("div");
  return effectScope().run(() => useTimelineAxis(shallowRef(element), { duration: 10_000, ticksPerUnit: 10, minScale: 1 }))!;
}

describe("useTimelineAxis", () => {
  it("fits the whole song by default", () => {
    const axis = makeAxis();
    expect(axis.scale.value).toBe(10);
    expect(axis.toX(10_000)).toBe(WIDTH);
    expect(axis.contentWidth.value).toBe(WIDTH);
  });

  it("keeps the middle of the view in place when zooming in", () => {
    const axis = makeAxis();
    const middle = axis.toTick(WIDTH / 2);
    axis.zoomIn();
    expect(axis.scale.value).toBeLessThan(10);
    expect(axis.toX(middle)).toBeCloseTo(WIDTH / 2, 0);
  });

  it("leaves out ranges outside the view and cuts the others to it", () => {
    const axis = makeAxis();
    axis.zoomIn();
    axis.zoomIn();
    axis.scrollTo(50);
    expect(axis.toBlock(0, axis.toTick(-1))).toBeUndefined();
    expect(axis.toBlock(axis.toTick(WIDTH + 1), 10_000)).toBeUndefined();
    expect(axis.toBlock(0, 10_000)).toEqual({ left: 0, width: WIDTH });
  });

  it("never scrolls past either end", () => {
    const axis = makeAxis();
    axis.zoomIn();
    axis.scrollTo(-20);
    expect(axis.offset.value).toBe(0);
    axis.scrollTo(1_000_000);
    expect(axis.offset.value).toBe(axis.contentWidth.value - WIDTH);
  });

  it("brings a tick outside the view back into it", () => {
    const axis = makeAxis();
    axis.zoomIn();
    axis.zoomIn();
    axis.reveal(9_000);
    expect(axis.isVisible(9_000)).toBe(true);
    axis.fit();
    expect(axis.offset.value).toBe(0);
    expect(axis.scale.value).toBe(10);
  });
});
