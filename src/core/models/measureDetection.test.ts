import { describe, expect, it } from "vitest";

import Measure from "./measure";
import { type DetectedMeasure, hasMeasureDetectionChanges, type MeasureDetectionOptions, planMeasureDetection } from "./measureDetection";

const placed = { page: 0, x: 0, y: 0, width: 0.1, height: 0.1 };
const layout = { page: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.1 };

const OPTIONS: MeasureDetectionOptions = { replacePlaced: false, createMissing: true, beats: 3 };

function detected(value: string, confidence = 0.9): DetectedMeasure {
  return { value, layout, confidence };
}

describe("planMeasureDetection", () => {
  it("places measures that exist without a layout", () => {
    const measure = new Measure("1", 4);

    const plan = planMeasureDetection([measure], [detected("1")], OPTIONS);

    expect(plan.placements).toEqual([{ measure, layout }]);
    expect(plan.additions).toEqual([]);
  });

  it("matches rehearsal letters regardless of case", () => {
    const measure = new Measure("12a", 4);

    const plan = planMeasureDetection([measure], [detected("12A")], OPTIONS);

    expect(plan.placements.map(p => p.measure)).toEqual([measure]);
  });

  it("keeps placed measures unless replacing is requested", () => {
    const measure = new Measure("1", 4, placed);

    const kept = planMeasureDetection([measure], [detected("1")], OPTIONS);
    const replaced = planMeasureDetection([measure], [detected("1")], { ...OPTIONS, replacePlaced: true });

    expect(kept.placements).toEqual([]);
    expect(kept.keptPlaced).toEqual(["1"]);
    expect(replaced.placements).toEqual([{ measure, layout }]);
  });

  it("creates missing measures with the given beats", () => {
    const plan = planMeasureDetection([], [detected("7")], OPTIONS);

    expect(plan.additions.map(m => [m.value, m.beats, m.layout])).toEqual([["7", 3, layout]]);
  });

  it("keeps missing measures as boxes without a number when creating is off", () => {
    const plan = planMeasureDetection([], [detected("7")], { ...OPTIONS, createMissing: false });

    expect(plan.additions).toEqual([]);
    expect(plan.unnumbered).toEqual([layout]);
    expect(hasMeasureDetectionChanges(plan)).toBe(true);
  });

  it("keeps boxes whose label is not a valid measure number", () => {
    const other = { ...layout, x: 0.1 };
    const plan = planMeasureDetection([], [detected("12AB"), { ...detected(""), layout: other }], OPTIONS);

    expect(plan.additions).toEqual([]);
    expect(plan.unnumbered).toEqual([layout, other]);
  });

  it("keeps the first box of a label that was read twice and the second without a number", () => {
    const plan = planMeasureDetection([], [detected("4"), { ...detected("4"), layout: placed }], OPTIONS);

    expect(plan.additions.map(m => m.layout)).toEqual([layout]);
    expect(plan.unnumbered).toEqual([placed]);
  });

  it("drops leftover boxes on top of boxes that are already there", () => {
    const covered = { ...layout, x: layout.x + 0.01, width: 0.1 };
    const existingBox = { page: 2, x: 0, y: 0, width: 0.5, height: 0.5 };
    const repeated = { page: 2, x: 0.1, y: 0.1, width: 0.1, height: 0.1 };

    const plan = planMeasureDetection(
      [new Measure("1", 4, layout)],
      [{ ...detected("x"), layout: covered }, { ...detected("y"), layout: repeated }],
      OPTIONS,
      [existingBox],
    );

    expect(plan.unnumbered).toEqual([]);
  });

  it("flags low confidence measures that will change for review", () => {
    const plan = planMeasureDetection(
      [new Measure("1", 4, placed), new Measure("2", 4)],
      [detected("1", 0.1), detected("2", 0.2), detected("3", 0.3), detected("4")],
      OPTIONS,
    );

    expect(plan.lowConfidence).toEqual(["2", "3"]);
    expect(plan.placements[0]!.layout).toEqual({ ...layout, review: true });
    expect(plan.additions.map(m => m.layout!.review)).toEqual([true, undefined]);
  });
});
