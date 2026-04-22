import { describe, expect, it } from "vitest";

import WarpMap from "./warp";

function map(...pairs: [tick: number, time: number][]): WarpMap {
  const w = new WarpMap();
  for (const [tick, time] of pairs) {
    w.addMarker({ tick, time });
  }
  return w;
}

describe("WarpMap", () => {
  it("interpolates linearly between markers", () => {
    const w = map([0, 0], [100, 10]);
    expect(w.tickToTime(50)).toBe(5);
    expect(w.timeToTick(7.5)).toBe(75);
  });

  it("extrapolates before and after markers using outermost slope", () => {
    const w = map([0, 0], [100, 10]); // slope = 0.1 s/tick
    expect(w.tickToTime(-50)).toBe(-5);
    expect(w.tickToTime(200)).toBe(20);
  });

  it("roundtrips tick → time → tick", () => {
    const w = map([0, 0], [480, 2], [960, 3]);
    for (const tick of [0, 100, 480, 720, 960, 1200]) {
      expect(w.timeToTick(w.tickToTime(tick))).toBeCloseTo(tick);
    }
  });

  it("rejects duplicate ticks and crossing times", () => {
    const w = map([0, 0], [100, 10]);
    expect(() => w.addMarker({ tick: 100, time: 5 })).toThrow();
    expect(() => w.addMarker({ tick: 50, time: 15 })).toThrow();
  });

  it("removes a marker and rebuilds correctly", () => {
    const w = map([0, 0], [100, 5], [200, 10]);
    w.removeMarker(100);
    expect(w.tickToTime(100)).toBe(5); // interpolated from remaining [0,0]→[200,10]
  });
});
