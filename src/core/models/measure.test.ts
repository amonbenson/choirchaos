import { describe, expect, it } from "vitest";

import Measure, { createEmptyMeasureEdit, isEmptyMeasureEdit, nextMeasureIds } from "./measure";

const LAYOUT = { page: 0, x: 0.1, y: 0.2, width: 0.1, height: 0.1 };

describe("Measure", () => {
  it("round-trips and stores no layout key without a box", () => {
    expect(new Measure("m1", "1", 4).serialize()).toEqual({ id: "m1", label: "1", beats: 4 });
    expect(Object.keys(new Measure("m1", "1", 4).serialize())).not.toContain("layout");

    const stored = { id: "m2", label: "2a", beats: 3, layout: { ...LAYOUT, review: true } };
    expect(Measure.deserialize(stored).serialize()).toEqual(stored);
  });

  it("hands out IDs after the highest existing one", () => {
    expect(nextMeasureIds([], 2)).toEqual(["m1", "m2"]);
    expect(nextMeasureIds([new Measure("m3", "1", 4), new Measure("m10", "2", 4)], 1)).toEqual(["m11"]);
  });
});

describe("MeasureEdit", () => {
  it("is empty without changes", () => {
    expect(isEmptyMeasureEdit(createEmptyMeasureEdit())).toBe(true);
    expect(isEmptyMeasureEdit({ ...createEmptyMeasureEdit(), unnumberedBoxes: [] })).toBe(false);
  });
});
