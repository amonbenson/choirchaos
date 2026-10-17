import { describe, expect, it } from "vitest";

import Measure, { type MeasureLayout } from "./measure";
import { isEmptyEdit, type MeasureEdit, type MeasureEditResult } from "./measureEditing";
import {
  countReviewItems,
  getAdjacentReviewItem,
  getReviewItemAfter,
  getReviewItems,
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

function okEdit(result: MeasureEditResult): MeasureEdit {
  if (result.status !== "ok") {
    throw new Error(`Expected an edit, got ${JSON.stringify(result)}`);
  }

  return result.edit;
}

describe("review items", () => {
  const one = new Measure("1", 4, flagged(0.1));
  const two = new Measure("2", 4, box(0.3));
  const three = new Measure("3", 4, flagged(0.1, 0.6));
  const unnumbered = [box(0.5), box(0.1, 0.2, 1)];

  it("lists flagged measures and unnumbered boxes in reading order", () => {
    const items = getReviewItems([one, two, three], unnumbered);

    expect(items.map(item => item.measure?.value ?? `box ${item.layout.page}:${item.layout.x}`)).toEqual(["1", "box 0:0.5", "3", "box 1:0.1"]);
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

  it("continues after a resolved item until none are left", () => {
    const items = getReviewItems([one], [box(0.5)]);

    expect(getReviewItemAfter(items, items[0]!)).toBe(items[1]);
    expect(getReviewItemAfter(items.slice(0, 1), items[0]!)).toBeUndefined();
  });
});

describe("resolving review items", () => {
  it("confirms by clearing the review flag only", () => {
    const measure = new Measure("1", 4, flagged(0.1));

    const edit = planConfirm([measure]);

    expect([...edit.layouts]).toEqual([[measure, box(0.1)]]);
    expect(edit.boxes).toEqual([measure]);
  });

  it("numbers a box onto a measure without one", () => {
    const list = [new Measure("1", 4, box(0.1)), new Measure("2", 3)];
    const unnumbered = box(0.3);

    const edit = okEdit(planNumberBox(list, unnumbered, "2", "midi"));

    expect(edit.layouts.get(list[1]!)).toEqual(unnumbered);
    expect(edit.resolvedBoxes).toEqual([unnumbered]);
  });

  it("creates the measure of a numbered box in audio songs only", () => {
    const list = [new Measure("1", 3, box(0.1))];

    const edit = okEdit(planNumberBox(list, box(0.3), "2", "audio"));

    expect(edit.additions.map(m => [m.value, m.beats, m.layout])).toEqual([["2", 3, box(0.3)]]);
    expect(planNumberBox(list, box(0.3), "2", "midi").status).toBe("invalid");
  });

  it("reports a measure that already has a box", () => {
    const list = [new Measure("1", 4, box(0.1))];

    expect(planNumberBox(list, box(0.3), "1", "audio")).toEqual({ status: "conflict", conflict: list[0] });
  });

  it("removes a box without touching any measure", () => {
    const edit = planRemoveUnnumberedBox(box(0.3));

    expect(edit.resolvedBoxes).toEqual([box(0.3)]);
    expect(isEmptyEdit(edit)).toBe(false);
  });
});
