import { describe, expect, it } from "vitest";

import WarpMap, { DEFAULT_SECONDS_PER_BEAT } from "./warp";

function map(...pairs: [beat: number, time: number][]): WarpMap {
  const w = new WarpMap();
  for (const [beat, time] of pairs) {
    w.addMarker({ beat, time });
  }

  return w;
}

describe("WarpMap", () => {
  it("interpolates linearly between markers", () => {
    const w = map([0, 0], [10, 20]);
    expect(w.beatToTime(5)).toBe(10);
    expect(w.timeToBeat(15)).toBe(7.5);
  });

  it("extrapolates before and after markers using outermost slope", () => {
    const w = map([0, 0], [10, 20]);
    expect(w.beatToTime(-5)).toBe(-10);
    expect(w.beatToTime(20)).toBe(40);
  });

  it("roundtrips beat → time → beat", () => {
    const w = map([0, 0], [8, 12], [16, 20]);
    for (const p of [0, 3, 8, 12, 16, 20]) {
      expect(w.timeToBeat(w.beatToTime(p))).toBeCloseTo(p);
    }
  });

  it("uses DEFAULT_SECONDS_PER_BEAT with no markers", () => {
    const w = new WarpMap();
    expect(w.beatToTime(1)).toBeCloseTo(DEFAULT_SECONDS_PER_BEAT);
    expect(w.timeToBeat(DEFAULT_SECONDS_PER_BEAT)).toBeCloseTo(1);
  });

  it("uses DEFAULT_SECONDS_PER_BEAT with one marker, offset to fit it", () => {
    const w = map([4, 10]);
    expect(w.beatToTime(4)).toBe(10);
    expect(w.beatToTime(5)).toBeCloseTo(10 + DEFAULT_SECONDS_PER_BEAT);
  });

  it("rejects non-integer beats", () => {
    const w = new WarpMap();
    expect(() => w.addMarker({ beat: 1.5, time: 3 })).toThrow();
  });

  it("rejects duplicate beats and crossing times", () => {
    const w = map([0, 0], [10, 20]);
    expect(() => w.addMarker({ beat: 10, time: 5 })).toThrow();
    expect(() => w.addMarker({ beat: 5, time: 25 })).toThrow();
  });

  it("removes a marker and rebuilds correctly", () => {
    const w = map([0, 0], [5, 5], [10, 20]);
    w.removeMarker(5);
    expect(w.beatToTime(5)).toBeCloseTo(10);
  });

  it("returns its markers sorted by beat", () => {
    const w = new WarpMap();
    w.setMarkers([{ beat: 4, time: 2 }, { beat: 1, time: 1 }]);
    expect(w.getMarkers().map(m => m.beat)).toEqual([1, 4]);
  });
});
