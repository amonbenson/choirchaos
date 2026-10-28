import { describe, expect, it } from "vitest";

import WarpMap, { DEFAULT_SECONDS_PER_POSITION } from "./warp";

function map(...pairs: [position: number, time: number][]): WarpMap {
  const w = new WarpMap();
  for (const [position, time] of pairs) {
    w.addMarker({ position, time });
  }

  return w;
}

describe("WarpMap", () => {
  it("interpolates linearly between markers", () => {
    const w = map([0, 0], [10, 20]);
    expect(w.positionToTime(5)).toBe(10);
    expect(w.timeToPosition(15)).toBe(7.5);
  });

  it("extrapolates before and after markers using outermost slope", () => {
    const w = map([0, 0], [10, 20]);
    expect(w.positionToTime(-5)).toBe(-10);
    expect(w.positionToTime(20)).toBe(40);
  });

  it("roundtrips position → time → position", () => {
    const w = map([0, 0], [8, 12], [16, 20]);
    for (const p of [0, 3, 8, 12, 16, 20]) {
      expect(w.timeToPosition(w.positionToTime(p))).toBeCloseTo(p);
    }
  });

  it("uses DEFAULT_SECONDS_PER_POSITION with no markers", () => {
    const w = new WarpMap();
    expect(w.positionToTime(1)).toBeCloseTo(DEFAULT_SECONDS_PER_POSITION);
    expect(w.timeToPosition(DEFAULT_SECONDS_PER_POSITION)).toBeCloseTo(1);
  });

  it("uses DEFAULT_SECONDS_PER_POSITION with one marker, offset to fit it", () => {
    const w = map([4, 10]);
    expect(w.positionToTime(4)).toBe(10);
    expect(w.positionToTime(5)).toBeCloseTo(10 + DEFAULT_SECONDS_PER_POSITION);
  });

  it("rejects non-integer positions", () => {
    const w = new WarpMap();
    expect(() => w.addMarker({ position: 1.5, time: 3 })).toThrow();
  });

  it("rejects duplicate positions and crossing times", () => {
    const w = map([0, 0], [10, 20]);
    expect(() => w.addMarker({ position: 10, time: 5 })).toThrow();
    expect(() => w.addMarker({ position: 5, time: 25 })).toThrow();
  });

  it("removes a marker and rebuilds correctly", () => {
    const w = map([0, 0], [5, 5], [10, 20]);
    w.removeMarker(5);
    expect(w.positionToTime(5)).toBeCloseTo(10);
  });

  it("returns its markers sorted by position", () => {
    const w = new WarpMap();
    w.setMarkers([{ position: 4, time: 2 }, { position: 1, time: 1 }]);
    expect(w.getMarkers().map(m => m.position)).toEqual([1, 4]);
  });
});
