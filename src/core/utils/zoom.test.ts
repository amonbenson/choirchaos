import { describe, expect, it } from "vitest";

import { getAnchoredStartTime, normalizeWheelDelta, ZoomLadder } from "./zoom";

describe("normalizeWheelDelta", () => {
  it("converts lines and pages to pixels", () => {
    expect(normalizeWheelDelta({ deltaY: 10, deltaMode: 0 })).toBe(10);
    expect(normalizeWheelDelta({ deltaY: 3, deltaMode: 1 })).toBe(48);
    expect(normalizeWheelDelta({ deltaY: -1, deltaMode: 2 })).toBe(-800);
  });
});

describe("ZoomLadder", () => {
  const ladder = (): ZoomLadder => new ZoomLadder({ min: 1, max: 4096, stepsPerDoubling: 4, pixelsPerStep: 50 });

  it("doubles after one step per doubling", () => {
    expect(ladder().step(16, 4)).toBeCloseTo(32);
    expect(ladder().step(16, -4)).toBeCloseTo(8);
  });

  it("clamps to its range", () => {
    expect(ladder().step(2, -20)).toBe(1);
    expect(ladder().step(2048, 20)).toBe(4096);
  });

  it("snaps arbitrary values onto the ladder", () => {
    expect(ladder().snap(33)).toBeCloseTo(32);
    expect(ladder().snap(5000)).toBe(4096);
  });

  it("accumulates small wheel deltas until a full step", () => {
    const zoom = ladder();
    let value = 64;

    for (let i = 0; i < 4; i++) {
      value = zoom.applyWheel(value, 10);
    }

    expect(value).toBe(64);
    value = zoom.applyWheel(value, 10);
    expect(value).toBeCloseTo(64 * Math.pow(2, 1 / 4));
  });

  it("zooms the same amount for one large delta and many small ones", () => {
    const large = ladder().applyWheel(64, -200);
    const smallZoom = ladder();
    let small = 64;
    for (let i = 0; i < 40; i++) {
      small = smallZoom.applyWheel(small, -5);
    }

    expect(small).toBeCloseTo(large);
    expect(large).toBeCloseTo(32);
  });
});

describe("getAnchoredStartTime", () => {
  it("keeps the anchor time under the anchor pixel", () => {
    // 100 samples per pixel at 1000 Hz: 0.1 s per pixel, so 50 px left of the anchor is 5 s earlier.
    expect(getAnchoredStartTime(12, 50, 100, 1000)).toBeCloseTo(7);
  });

  it("never scrolls before the start", () => {
    expect(getAnchoredStartTime(1, 500, 100, 1000)).toBe(0);
  });
});
