import { describe, expect, it } from "vitest";

import Measure, { type MeasureLayout } from "./measure";
import {
  changesPlayback,
  getCommonBeats,
  getDefaultBeats,
  getDefaultFirstNumber,
  getMeasuresBetween,
  getNextNumber,
  getReadingOrder,
  getUnplacedRuns,
  isEmptyEdit,
  type MeasureEdit,
  type MeasureEditResult,
  planBeats,
  planNewBox,
  planRenumber,
} from "./measureEditing";

function box(x: number, y: number, page = 0): MeasureLayout {
  return { page, x, y, width: 0.1, height: 0.1 };
}

function measures(...entries: [string, MeasureLayout?, number?][]): Measure[] {
  return entries.map(([value, layout, beats]) => new Measure(value, beats ?? 4, layout));
}

function byValue(list: Measure[], value: string): Measure {
  return list.find(measure => measure.value === value)!;
}

function okEdit(result: MeasureEditResult): MeasureEdit {
  if (result.status !== "ok") {
    throw new Error(`Expected an edit, got ${JSON.stringify(result)}`);
  }

  return result.edit;
}

function layoutsAfter(list: Measure[], edit: MeasureEdit): Record<string, MeasureLayout | undefined> {
  const result: Record<string, MeasureLayout | undefined> = {};
  for (const measure of [...list, ...edit.additions]) {
    const value = edit.renames.get(measure) ?? measure.value;
    result[value] = edit.layouts.has(measure) ? edit.layouts.get(measure) : measure.layout;
  }

  return result;
}

describe("reading order", () => {
  it("reads page by page, row by row and left to right", () => {
    const list = measures(
      ["1", box(0.5, 0.52, 1)],
      ["2", box(0.1, 0.5)],
      ["3", box(0.4, 0.21)],
      ["4", box(0.1, 0.2)],
      ["5"],
      ["6", box(0.5, 0.48)],
    );

    expect(getReadingOrder(list).map(m => m.value)).toEqual(["4", "3", "2", "6", "1"]);
  });

  it("selects a range across rows in reading order", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.5, 0.2)], ["3", box(0.1, 0.5)], ["4", box(0.5, 0.5)]);

    expect(getMeasuresBetween(list, byValue(list, "4"), byValue(list, "2")).map(m => m.value)).toEqual(["2", "3", "4"]);
  });
});

describe("numbering", () => {
  const list = measures(["1"], ["2"], ["2a"], ["3"], ["7"]);

  it("follows the beat map in MIDI songs", () => {
    expect(getNextNumber(list, "2", "midi")).toBe("2a");
    expect(getNextNumber(list, "3", "midi")).toBe("7");
    expect(getNextNumber(list, "7", "midi")).toBeUndefined();
  });

  it("continues with whole numbers in audio songs unless a measure comes first", () => {
    expect(getNextNumber(list, "2", "audio")).toBe("2a");
    expect(getNextNumber(list, "2a", "audio")).toBe("3");
    expect(getNextNumber(list, "3", "audio")).toBe("4");
    expect(getNextNumber(list, "7", "audio")).toBe("8");
  });

  it("starts a new box after the box before it", () => {
    const placed = measures(["1", box(0.1, 0.2), 3], ["2", box(0.3, 0.2), 5], ["3"]);

    expect(getDefaultFirstNumber(placed, box(0.5, 0.2), "midi")).toBe("3");
    expect(getDefaultFirstNumber(placed, box(0.0, 0.1), "midi")).toBe("1");
    expect(getDefaultFirstNumber(measures(), box(0.0, 0.1), "audio")).toBe("1");
    expect(getDefaultBeats(placed, box(0.5, 0.2))).toBe(5);
    expect(getDefaultBeats(placed, box(0.0, 0.1))).toBe(4);
  });
});

describe("planRenumber", () => {
  it("moves a box to a measure without one", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"], ["3", box(0.5, 0.2)]);

    const edit = okEdit(planRenumber(list, [byValue(list, "1")], "2", "midi"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: undefined, 2: box(0.1, 0.2), 3: box(0.5, 0.2) });
    expect(edit.boxes).toEqual([byValue(list, "2")]);
    expect(changesPlayback(edit)).toBe(false);
  });

  it("reports the measure in the way", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"], ["3", box(0.5, 0.2)]);

    expect(planRenumber(list, [byValue(list, "1")], "3", "midi")).toEqual({ status: "conflict", conflict: byValue(list, "3") });
  });

  it("swaps two boxes", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"], ["3", box(0.5, 0.2)]);

    const edit = okEdit(planRenumber(list, [byValue(list, "1")], "3", "midi", "swap"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: box(0.5, 0.2), 2: undefined, 3: box(0.1, 0.2) });
  });

  it("shifts the following boxes until a measure without a box takes the last one", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.2, 0.2)], ["3", box(0.3, 0.2)], ["4"], ["5", box(0.5, 0.2)], ["6", box(0.6, 0.2)]);

    const edit = okEdit(planRenumber(list, [byValue(list, "6")], "2", "midi", "shift"));

    expect(layoutsAfter(list, edit)).toEqual({
      1: box(0.1, 0.2),
      2: box(0.6, 0.2),
      3: box(0.2, 0.2),
      4: box(0.3, 0.2),
      5: box(0.5, 0.2),
      6: undefined,
    });
  });

  it("numbers several boxes in reading order", () => {
    const list = measures(["1"], ["2"], ["3"], ["8", box(0.1, 0.5)], ["9", box(0.1, 0.2)]);

    const edit = okEdit(planRenumber(list, [byValue(list, "8"), byValue(list, "9")], "2", "midi"));

    expect(layoutsAfter(list, edit)).toMatchObject({ 2: box(0.1, 0.2), 3: box(0.1, 0.5), 8: undefined, 9: undefined });
  });

  it("rejects numbers outside the beat map", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"]);

    expect(planRenumber(list, [byValue(list, "1")], "9", "midi").status).toBe("invalid");
    expect(planRenumber(list, [byValue(list, "1")], "x y", "audio").status).toBe("invalid");
  });

  it("renames audio measures instead of leaving empty ones behind", () => {
    const list = measures(["5", box(0.1, 0.2), 3], ["6", box(0.3, 0.2)]);

    const edit = okEdit(planRenumber(list, list, "1", "audio"));

    expect([...edit.renames.values()]).toEqual(["1", "2"]);
    expect(edit.additions).toEqual([]);
    expect(layoutsAfter(list, edit)).toEqual({ 1: box(0.1, 0.2), 2: box(0.3, 0.2) });
    expect(changesPlayback(edit)).toBe(true);
  });

  it("does nothing when a box keeps its number", () => {
    const list = measures(["1", box(0.1, 0.2)]);

    expect(isEmptyEdit(okEdit(planRenumber(list, list, "1", "midi")))).toBe(true);
  });
});

describe("planNewBox", () => {
  it("splits a box over consecutive beat map measures", () => {
    const list = measures(["1"], ["2"], ["3"]);

    const edit = okEdit(planNewBox(list, { page: 0, x: 0, y: 0, width: 0.4, height: 0.1 }, { count: 2, start: "2", beats: 4 }, "midi"));

    expect(layoutsAfter(list, edit)).toEqual({
      1: undefined,
      2: { page: 0, x: 0, y: 0, width: 0.2, height: 0.1 },
      3: { page: 0, x: 0.2, y: 0, width: 0.2, height: 0.1 },
    });
  });

  it("does not run past the end of the beat map", () => {
    const list = measures(["1"], ["2"]);

    expect(planNewBox(list, box(0, 0), { count: 3, start: "1", beats: 4 }, "midi").status).toBe("invalid");
  });

  it("creates audio measures and shifts the boxes in the way", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.2, 0.2)], ["3", box(0.3, 0.2)]);

    expect(planNewBox(list, box(0.15, 0.2), { count: 1, start: "2", beats: 3 }, "audio").status).toBe("conflict");
    const edit = okEdit(planNewBox(list, box(0.15, 0.2), { count: 1, start: "2", beats: 3 }, "audio", "shift"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: box(0.1, 0.2), 2: box(0.15, 0.2), 3: box(0.2, 0.2), 4: box(0.3, 0.2) });
    expect(edit.additions.map(m => [m.value, m.beats])).toEqual([["4", 3]]);
  });
});

describe("bulk edits", () => {
  it("shows mixed beats as empty and only changes the ones that differ", () => {
    const list = measures(["1", undefined, 3], ["2", undefined, 4]);

    expect(getCommonBeats(list)).toBeUndefined();
    expect(getCommonBeats([list[0]!])).toBe(3);
    expect([...planBeats(list, 4).beats.keys()]).toEqual([list[0]]);
  });

  it("groups unplaced measures into runs", () => {
    const list = measures(["1"], ["2"], ["3", box(0, 0)], ["4"]);

    expect(getUnplacedRuns(list).map(run => [run.first.value, run.last.value, run.count])).toEqual([["1", "2", 2], ["4", "4", 1]]);
  });
});
