import { describe, expect, it } from "vitest";

import { formatRulerTime, getMedian, getMultiplesBetween, MEASURE_STEPS, pickRulerStep, TIME_STEPS } from "./rulerTicks";

describe("pickRulerStep", () => {
  it("labels every unit when they lie far enough apart", () => {
    expect(pickRulerStep(MEASURE_STEPS, 40, 28)).toBe(1);
  });

  it("skips units until labels lie far enough apart", () => {
    expect(pickRulerStep(MEASURE_STEPS, 10, 28)).toBe(4);
    expect(pickRulerStep(TIME_STEPS, 4, 56)).toBe(15);
  });

  it("falls back to the largest step", () => {
    expect(pickRulerStep(TIME_STEPS, 0.001, 56)).toBe(3600);
  });
});

describe("getMultiplesBetween", () => {
  it("lists the multiples inside the range, both ends included", () => {
    expect(getMultiplesBetween(3, 20, 5)).toEqual([5, 10, 15, 20]);
    expect(getMultiplesBetween(0, 4, 2)).toEqual([0, 2, 4]);
  });

  it("is empty when no multiple lies inside", () => {
    expect(getMultiplesBetween(11, 14, 5)).toEqual([]);
  });
});

describe("formatRulerTime", () => {
  it("shows minutes and two digit seconds", () => {
    expect(formatRulerTime(0)).toBe("0:00");
    expect(formatRulerTime(65)).toBe("1:05");
    expect(formatRulerTime(600)).toBe("10:00");
  });
});

describe("getMedian", () => {
  it("takes the middle value, or the mean of the two middle values", () => {
    expect(getMedian([3, 1, 2])).toBe(2);
    expect(getMedian([4, 1, 2, 3])).toBe(2.5);
    expect(getMedian([])).toBeUndefined();
  });
});
