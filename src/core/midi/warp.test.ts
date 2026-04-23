import { describe, expect, it } from "vitest";

import WarpMap, { DEFAULT_SECONDS_PER_MEASURE } from "./warp";

function map(...pairs: [measure: number, time: number][]): WarpMap {
  const w = new WarpMap();
  for (const [measure, time] of pairs) {
    w.addMarker({ measure, time });
  }

  return w;
}

describe("WarpMap", () => {
  it("interpolates linearly between markers", () => {
    const w = map([0, 0], [10, 20]); // 2 s/measure
    expect(w.measureToTime(5)).toBe(10);
    expect(w.timeToMeasure(15)).toBe(7.5);
  });

  it("extrapolates before and after markers using outermost slope", () => {
    const w = map([0, 0], [10, 20]); // 2 s/measure
    expect(w.measureToTime(-5)).toBe(-10);
    expect(w.measureToTime(20)).toBe(40);
  });

  it("roundtrips measure → time → measure", () => {
    const w = map([0, 0], [8, 12], [16, 20]);
    for (const m of [0, 3, 8, 12, 16, 20]) {
      expect(w.timeToMeasure(w.measureToTime(m))).toBeCloseTo(m);
    }
  });

  it("uses DEFAULT_SECONDS_PER_MEASURE with no markers", () => {
    const w = new WarpMap();
    expect(w.measureToTime(1)).toBeCloseTo(DEFAULT_SECONDS_PER_MEASURE);
    expect(w.timeToMeasure(DEFAULT_SECONDS_PER_MEASURE)).toBeCloseTo(1);
  });

  it("uses DEFAULT_SECONDS_PER_MEASURE with one marker, offset to fit it", () => {
    const w = map([4, 10]); // measure 4 → 10s
    expect(w.measureToTime(4)).toBe(10);
    expect(w.measureToTime(5)).toBeCloseTo(10 + DEFAULT_SECONDS_PER_MEASURE);
  });

  it("rejects non-integer measures", () => {
    const w = new WarpMap();
    expect(() => w.addMarker({ measure: 1.5, time: 3 })).toThrow();
  });

  it("rejects duplicate measures and crossing times", () => {
    const w = map([0, 0], [10, 20]);
    expect(() => w.addMarker({ measure: 10, time: 5 })).toThrow();
    expect(() => w.addMarker({ measure: 5, time: 25 })).toThrow();
  });

  it("removes a marker and rebuilds correctly", () => {
    const w = map([0, 0], [5, 5], [10, 20]);
    w.removeMarker(5);
    expect(w.measureToTime(5)).toBeCloseTo(10); // interpolated from [0,0]→[10,20]
  });
});
