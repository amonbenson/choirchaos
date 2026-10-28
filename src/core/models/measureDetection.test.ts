import { describe, expect, it } from "vitest";

import Measure from "./measure";
import { type DetectedMeasure, hasMeasureDetectionChanges, type MeasureDetectionOptions, planMeasureDetection, toMeasureEdit } from "./measureDetection";

const placed = { page: 0, x: 0, y: 0, width: 0.1, height: 0.1 };
const layout = { page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.1 };

const OPTIONS: MeasureDetectionOptions = { replacePlaced: false, createMissing: true, beats: 3 };

function detected(value: string, confidence = 0.9, at = layout): DetectedMeasure {
  return { value, layout: at, confidence };
}

describe("planMeasureDetection", () => {
  it("places measures that exist without a layout", () => {
    const measure = new Measure("m1", "1", 4);

    const plan = planMeasureDetection([measure], [detected("1")], OPTIONS);

    expect(plan.placements).toEqual([{ measure, layout }]);
    expect(plan.additions).toEqual([]);
  });

  it("matches labels regardless of case", () => {
    const measure = new Measure("m1", "12a", 4);

    const plan = planMeasureDetection([measure], [detected("12A")], OPTIONS);

    expect(plan.placements.map(p => p.measure)).toEqual([measure]);
  });

  it("keeps placed measures unless replacing is requested", () => {
    const measure = new Measure("m1", "1", 4, placed);

    const kept = planMeasureDetection([measure], [detected("1")], OPTIONS);
    const replaced = planMeasureDetection([measure], [detected("1")], { ...OPTIONS, replacePlaced: true });

    expect(kept.placements).toEqual([]);
    expect(kept.keptPlaced).toEqual(["1"]);
    expect(replaced.placements).toEqual([{ measure, layout }]);
  });

  it("creates missing measures with the given beats", () => {
    const plan = planMeasureDetection([], [detected("7")], OPTIONS);

    expect(plan.additions).toEqual([{ label: "7", beats: 3, layout, index: 0 }]);
  });

  it("puts new measures at the reading order position of their box", () => {
    const existing = [
      new Measure("m1", "1", 4, { ...placed, x: 0.1 }),
      new Measure("m2", "3", 4),
      new Measure("m3", "4", 4, { ...placed, x: 0.7 }),
    ];

    const plan = planMeasureDetection(existing, [
      detected("5", 0.9, { ...placed, x: 0.9 }),
      detected("2", 0.9, { ...placed, x: 0.3 }),
      detected("3", 0.9, { ...placed, x: 0.5 }),
    ], OPTIONS);

    expect(plan.placements.map(p => p.measure.id)).toEqual(["m2"]);
    expect(plan.additions.map(addition => [addition.label, addition.index])).toEqual([["5", 4], ["2", 1]]);
  });

  it("keeps missing measures as boxes without a number when creating is off", () => {
    const plan = planMeasureDetection([], [detected("7")], { ...OPTIONS, createMissing: false });

    expect(plan.additions).toEqual([]);
    expect(plan.unnumbered).toEqual([layout]);
    expect(hasMeasureDetectionChanges(plan)).toBe(true);
  });

  it("creates no measures from text that is not a measure number", () => {
    const other = { ...layout, x: 0.1 };
    const plan = planMeasureDetection([], [detected("12AB"), detected("", 0.9, other)], OPTIONS);

    expect(plan.additions).toEqual([]);
    expect(plan.unnumbered).toEqual([layout, other]);
  });

  it("places existing measures with any label", () => {
    const measure = new Measure("m1", "Coda", 4);

    expect(planMeasureDetection([measure], [detected("coda")], OPTIONS).placements.map(p => p.measure)).toEqual([measure]);
  });

  it("keeps the first box of a label that was read twice and the second without a number", () => {
    const plan = planMeasureDetection([], [detected("4"), detected("4", 0.9, placed)], OPTIONS);

    expect(plan.additions.map(addition => addition.layout)).toEqual([layout]);
    expect(plan.unnumbered).toEqual([placed]);
  });

  it("drops leftover boxes on top of boxes that are already there", () => {
    const covered = { ...layout, x: layout.x + 0.01, width: 0.1 };
    const existingBox = { page: 2, x: 0, y: 0, width: 0.5, height: 0.5 };
    const repeated = { page: 2, x: 0.1, y: 0.1, width: 0.1, height: 0.1 };

    const plan = planMeasureDetection(
      [new Measure("m1", "1", 4, layout)],
      [detected("x", 0.9, covered), detected("y", 0.9, repeated)],
      OPTIONS,
      [existingBox],
    );

    expect(plan.unnumbered).toEqual([]);
  });

  it("flags low confidence measures that will change for review", () => {
    const plan = planMeasureDetection(
      [new Measure("m1", "1", 4, placed), new Measure("m2", "2", 4)],
      [detected("1", 0.1), detected("2", 0.2), detected("3", 0.3), detected("4")],
      OPTIONS,
    );

    expect(plan.lowConfidence).toEqual(["2", "3"]);
    expect(plan.placements[0]!.layout).toEqual({ ...layout, review: true });
    expect(plan.additions.map(addition => addition.layout!.review)).toEqual([true, undefined]);
  });

  it("never adds measures to a MIDI song", () => {
    const plan = planMeasureDetection([new Measure("m1", "1", 4)], [detected("1"), detected("2", 0.9, placed)], { ...OPTIONS, createMissing: false });

    expect(plan.additions).toEqual([]);
    expect(plan.unnumbered).toEqual([placed]);
  });
});

describe("toMeasureEdit", () => {
  it("turns the plan into one edit that appends the leftovers to the boxes without a number", () => {
    const existingBox = { page: 2, x: 0, y: 0, width: 0.1, height: 0.1 };
    const plan = planMeasureDetection([new Measure("m1", "1", 4)], [detected("1"), detected("2", 0.2, placed), detected("", 0.9, { ...placed, page: 3 })], OPTIONS);

    const { edit } = toMeasureEdit(plan, [existingBox]);

    expect([...edit.layouts]).toEqual([["m1", layout]]);
    expect(edit.additions).toEqual([{ label: "2", beats: 3, layout: { ...placed, review: true }, index: 0 }]);
    expect(edit.unnumberedBoxes).toEqual([existingBox, { ...placed, page: 3 }]);
  });

  it("keeps the boxes without a number when nothing is left over", () => {
    const plan = planMeasureDetection([new Measure("m1", "1", 4)], [detected("1")], OPTIONS);

    expect(toMeasureEdit(plan, []).edit.unnumberedBoxes).toBeUndefined();
  });
});
