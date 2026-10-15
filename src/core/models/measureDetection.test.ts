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

  it("reports missing measures instead of creating them when creating is off", () => {
    const plan = planMeasureDetection([], [detected("7")], { ...OPTIONS, createMissing: false });

    expect(plan.additions).toEqual([]);
    expect(plan.unmatched).toEqual(["7"]);
    expect(hasMeasureDetectionChanges(plan)).toBe(false);
  });

  it("reports labels that are not valid measure numbers", () => {
    const plan = planMeasureDetection([], [detected("12AB"), detected(""), detected("")], OPTIONS);

    expect(plan.additions).toEqual([]);
    expect(plan.unmatched).toEqual(["12AB", "", ""]);
    expect(plan.duplicates).toEqual([]);
  });

  it("keeps the first box of a label that was read twice", () => {
    const plan = planMeasureDetection([], [detected("4"), { ...detected("4"), layout: placed }], OPTIONS);

    expect(plan.additions.map(m => m.layout)).toEqual([layout]);
    expect(plan.duplicates).toEqual(["4"]);
  });

  it("lists low confidence measures that will change", () => {
    const plan = planMeasureDetection(
      [new Measure("1", 4, placed), new Measure("2", 4)],
      [detected("1", 0.1), detected("2", 0.2), detected("3", 0.3), detected("4")],
      OPTIONS,
    );

    expect(plan.lowConfidence).toEqual(["2", "3"]);
  });
});
