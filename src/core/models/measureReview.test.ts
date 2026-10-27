import { describe, expect, it } from "vitest";

import Measure, { isEmptyMeasureEdit, type MeasureLayout } from "./measure";
import type { MeasureEditResult, PlannedEdit } from "./measureEditing";
import {
  countReviewItems,
  getAdjacentReviewItem,
  getReviewItemAfter,
  getReviewItems,
  isSameReviewItem,
  planConfirm,
  planNumberBox,
  planRemoveUnnumberedBox,
} from "./measureReview";

function box(x: number, y = 0.2, page = 0): MeasureLayout {
  return { page, x, y, width: 0.1, height: 0.1 };
}

function flagged(x: number, y = 0.2, page = 0): MeasureLayout {
  return { ...box(x, y, page), review: true };
}

function ok(result: MeasureEditResult): PlannedEdit {
  if (result.status !== "ok") {
    throw new Error(`Expected an edit, got ${JSON.stringify(result)}`);
  }

  return result;
}

describe("review items", () => {
  const one = new Measure("m1", "1", 4, flagged(0.1));
  const two = new Measure("m2", "2", 4, box(0.3));
  const three = new Measure("m3", "3", 4, flagged(0.1, 0.6));
  const unnumbered = [box(0.5), box(0.1, 0.2, 1)];

  it("lists flagged measures and unnumbered boxes in reading order", () => {
    const items = getReviewItems([one, two, three], unnumbered);

    expect(items.map(item => item.measure?.label ?? `box ${item.layout.page}:${item.layout.x}`)).toEqual(["1", "box 0:0.5", "3", "box 1:0.1"]);
    expect(countReviewItems([one, two, three], unnumbered)).toBe(4);
  });

  it("steps through the items and wraps around", () => {
    const items = getReviewItems([one, two, three], unnumbered);

    expect(getAdjacentReviewItem(items, undefined, 1)).toBe(items[0]);
    expect(getAdjacentReviewItem(items, undefined, -1)).toBe(items[3]);
    expect(getAdjacentReviewItem(items, items[3], 1)).toBe(items[0]);
    expect(getAdjacentReviewItem(items, { layout: { ...unnumbered[0]! } }, 1)).toBe(items[2]);
    expect(getAdjacentReviewItem(items, items[0], -1)).toBe(items[3]);
    expect(getAdjacentReviewItem([], undefined, 1)).toBeUndefined();
  });

  it("identifies measures by ID, so a relabeled or moved measure stays the same item", () => {
    const relabeled = new Measure("m1", "1a", 4, flagged(0.2));

    expect(isSameReviewItem({ layout: one.layout!, measure: one }, { layout: relabeled.layout!, measure: relabeled })).toBe(true);
    expect(isSameReviewItem({ layout: one.layout!, measure: one }, { layout: one.layout! })).toBe(false);
  });

  it("continues after a resolved item until none are left", () => {
    const items = getReviewItems([one], [box(0.5)]);

    expect(getReviewItemAfter(items, items[0]!)).toBe(items[1]);
    expect(getReviewItemAfter(items.slice(0, 1), items[0]!)).toBeUndefined();
  });
});

describe("resolving review items", () => {
  it("confirms by clearing the review flag only", () => {
    const measure = new Measure("m1", "1", 4, flagged(0.1));

    const { edit, boxes } = planConfirm([measure]);

    expect([...edit.layouts]).toEqual([["m1", box(0.1)]]);
    expect(boxes).toEqual([{ measure: "m1" }]);
  });

  it("numbers a box onto a measure without one", () => {
    const list = [new Measure("m1", "1", 4, box(0.1)), new Measure("m2", "2", 3)];
    const unnumbered = [box(0.3), box(0.5)];

    const { edit, boxes } = ok(planNumberBox(list, unnumbered, { ...unnumbered[0]! }, "2", "midi"));

    expect(edit.layouts.get("m2")).toEqual(unnumbered[0]);
    expect(edit.unnumberedBoxes).toEqual([unnumbered[1]]);
    expect(boxes).toEqual([{ measure: "m2" }]);
  });

  it("creates the measure of a numbered box in audio songs only", () => {
    const list = [new Measure("m1", "1", 3, box(0.1))];

    const { edit, boxes } = ok(planNumberBox(list, [box(0.3)], box(0.3), "2", "audio"));

    expect(edit.additions).toEqual([{ label: "2", beats: 3, layout: box(0.3), index: 1 }]);
    expect(edit.unnumberedBoxes).toEqual([]);
    expect(boxes).toEqual([{ addition: 0 }]);
    expect(planNumberBox(list, [box(0.3)], box(0.3), "2", "midi").status).toBe("invalid");
  });

  it("reports a measure that already has a box", () => {
    const list = [new Measure("m1", "1", 4, box(0.1))];

    expect(planNumberBox(list, [box(0.3)], box(0.3), "1", "audio")).toEqual({ status: "conflict", conflict: list[0] });
  });

  it("removes a box without touching any measure", () => {
    const { edit } = planRemoveUnnumberedBox([box(0.3), box(0.5)], box(0.3));

    expect(edit.unnumberedBoxes).toEqual([box(0.5)]);
    expect(isEmptyMeasureEdit(edit)).toBe(false);
  });
});
