import { afterEach, describe, expect, it, vi } from "vitest";

import { idOf, makeAudioSongWithCut, makeAudioSongWithRepeat, makeMidiSong } from "@/test/fixtures";

import Measure, { changesPlayback, isEmptyMeasureEdit, type MeasureEdit, type MeasureLayout } from "./measure";
import {
  findExistingLabels,
  getCommonBeats,
  getDefaultBeats,
  getDefaultLabel,
  getMeasuresBetween,
  getPlannedLabels,
  getReadingOrder,
  getUnplacedRuns,
  type MeasureEditResult,
  planAddMeasures,
  planBeats,
  planDeleteMeasures,
  planLayouts,
  type PlannedEdit,
  planNewBox,
  planRemoveBoxes,
  planRenumber,
} from "./measureEditing";
import Song from "./song";

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

function box(x: number, y: number, page = 0): MeasureLayout {
  return { page, x, y, width: 0.1, height: 0.1 };
}

/** Measures with the IDs "m1", "m2", ... in the given order. */
function measures(...entries: [string, MeasureLayout?, number?][]): Measure[] {
  return entries.map(([label, layout, beats], i) => new Measure(`m${i + 1}`, label, beats ?? 4, layout));
}

function byLabel(list: readonly Measure[], label: string): Measure {
  return list.find(measure => measure.label === label)!;
}

function ok(result: MeasureEditResult): PlannedEdit {
  if (result.status !== "ok") {
    throw new Error(`Expected an edit, got ${JSON.stringify(result)}`);
  }

  return result;
}

/** Layouts by label after the edit, the way the song would store them. */
function layoutsAfter(list: readonly Measure[], edit: MeasureEdit): Record<string, MeasureLayout | undefined> {
  const result: Record<string, MeasureLayout | undefined> = {};
  for (const measure of list) {
    const label = edit.relabels.get(measure.id) ?? measure.label;
    result[label] = edit.layouts.has(measure.id) ? edit.layouts.get(measure.id) : measure.layout;
  }

  for (const addition of edit.additions) {
    result[addition.label] = addition.layout;
  }

  return result;
}

function makeAudioSong(list: Measure[] = [], spans = list.length > 0 ? [{ from: list[0]!.id, to: list.at(-1)!.id }] : []): Song {
  return new Song("song-id", "1", "Song", undefined, undefined, undefined, ["mix.mp3"], [], { measures: list, spans });
}

function playedLabels(song: Song): string[] {
  return song.getTimeline().map(entry => song.findMeasure(entry.measure)!.label);
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

    expect(getReadingOrder(list).map(m => m.label)).toEqual(["4", "3", "2", "6", "1"]);
  });

  it("selects a range across rows in reading order", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.5, 0.2)], ["3", box(0.1, 0.5)], ["4", box(0.5, 0.5)]);

    expect(getMeasuresBetween(list, "m4", "m2").map(m => m.label)).toEqual(["2", "3", "4"]);
  });
});

describe("default labels", () => {
  it("continues after the box before it", () => {
    const placed = measures(["1", box(0.1, 0.2), 3], ["2", box(0.3, 0.2), 5], ["3"]);

    expect(getDefaultLabel(placed, box(0.5, 0.2), "midi")).toBe("3");
    expect(getDefaultLabel(placed, box(0.0, 0.1), "midi")).toBe("1");
    expect(getDefaultLabel(measures(), box(0.0, 0.1), "audio")).toBe("1");
    expect(getDefaultBeats(placed, box(0.5, 0.2))).toBe(5);
    expect(getDefaultBeats(placed, box(0.0, 0.1))).toBe(4);
  });

  it("follows the score order of MIDI songs and whole numbers in audio songs", () => {
    const list = measures(["1", box(0.1, 0.2)], ["Coda", box(0.3, 0.2)], ["2"]);

    expect(getDefaultLabel(list, box(0.5, 0.2), "midi")).toBe("2");
    expect(getDefaultLabel(list, box(0.2, 0.2), "audio")).toBe("2");
    expect(getDefaultLabel(list, box(0.5, 0.2), "audio")).toBeUndefined();
  });
});

describe("planRenumber", () => {
  it("moves a box to a measure without one", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"], ["3", box(0.5, 0.2)]);

    const { edit, boxes } = ok(planRenumber(list, [byLabel(list, "1")], "2", "midi"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: undefined, 2: box(0.1, 0.2), 3: box(0.5, 0.2) });
    expect(boxes).toEqual([{ measure: "m2" }]);
    expect(changesPlayback(edit)).toBe(false);
  });

  it("reports the measure in the way", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"], ["3", box(0.5, 0.2)]);

    expect(planRenumber(list, [byLabel(list, "1")], "3", "midi")).toEqual({ status: "conflict", conflict: byLabel(list, "3") });
  });

  it("swaps two boxes", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"], ["3", box(0.5, 0.2)]);

    const { edit, boxes } = ok(planRenumber(list, [byLabel(list, "1")], "3", "midi", "swap"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: box(0.5, 0.2), 2: undefined, 3: box(0.1, 0.2) });
    expect(boxes).toEqual([{ measure: "m3" }]);
  });

  it("shifts the following boxes until a measure without a box takes the last one", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.2, 0.2)], ["3", box(0.3, 0.2)], ["4"], ["5", box(0.5, 0.2)], ["6", box(0.6, 0.2)]);

    const { edit } = ok(planRenumber(list, [byLabel(list, "6")], "2", "midi", "shift"));

    expect(layoutsAfter(list, edit)).toEqual({
      1: box(0.1, 0.2),
      2: box(0.6, 0.2),
      3: box(0.2, 0.2),
      4: box(0.3, 0.2),
      5: box(0.5, 0.2),
      6: undefined,
    });
  });

  it("follows the score order of the beat map, whatever the labels", () => {
    const list = measures(["8", box(0.1, 0.2)], ["8R", box(0.2, 0.2)], ["9"]);

    const { edit } = ok(planRenumber(list, [byLabel(list, "8")], "8R", "midi", "shift"));

    expect(layoutsAfter(list, edit)).toEqual({ "8": undefined, "8R": box(0.1, 0.2), "9": box(0.2, 0.2) });
  });

  it("numbers several boxes in reading order", () => {
    const list = measures(["1"], ["2"], ["3"], ["8", box(0.1, 0.5)], ["9", box(0.1, 0.2)]);

    const { edit, boxes } = ok(planRenumber(list, [byLabel(list, "8"), byLabel(list, "9")], "2", "midi"));

    expect(layoutsAfter(list, edit)).toMatchObject({ 2: box(0.1, 0.2), 3: box(0.1, 0.5), 8: undefined, 9: undefined });
    expect(boxes).toEqual([{ measure: "m2" }, { measure: "m3" }]);
  });

  it("rejects labels outside the beat map and empty labels", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2"]);

    expect(planRenumber(list, [byLabel(list, "1")], "9", "midi").status).toBe("invalid");
    expect(planRenumber(list, [byLabel(list, "2")], "3", "midi", "shift").status).toBe("invalid");
    expect(planRenumber(list, [byLabel(list, "1")], "", "audio").status).toBe("invalid");
  });

  it("relabels audio measures instead of leaving empty ones behind, keeping their IDs", () => {
    const list = measures(["5", box(0.1, 0.2), 3], ["6", box(0.3, 0.2)]);

    const { edit, boxes } = ok(planRenumber(list, list, "1", "audio"));

    expect([...edit.relabels]).toEqual([["m1", "1"], ["m2", "2"]]);
    expect(edit.additions).toEqual([]);
    expect(layoutsAfter(list, edit)).toEqual({ 1: box(0.1, 0.2), 2: box(0.3, 0.2) });
    expect(boxes).toEqual([{ measure: "m1" }, { measure: "m2" }]);
    expect(changesPlayback(edit)).toBe(false);
  });

  it("accepts free text labels in audio songs", () => {
    const list = measures(["12", box(0.1, 0.2)]);

    const { edit } = ok(planRenumber(list, list, "12R", "audio"));

    expect([...edit.relabels]).toEqual([["m1", "12R"]]);
  });

  it("creates a measure when the box's measure keeps another box", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.3, 0.2)], ["3", box(0.5, 0.2)]);

    const planned = ok(planRenumber(list, [byLabel(list, "2")], "3", "audio", "shift"));

    expect(planned.edit.relabels.size).toBe(0);
    expect(planned.edit.additions).toEqual([{ label: "4", beats: 4, layout: box(0.5, 0.2), index: 3 }]);
    expect(layoutsAfter(list, planned.edit)).toEqual({ 1: box(0.1, 0.2), 2: undefined, 3: box(0.3, 0.2), 4: box(0.5, 0.2) });
  });

  it("clears the review flag of a renumbered box but not of the boxes it shifts", () => {
    const flagged = { ...box(0.1, 0.2), review: true };
    const shifted = { ...box(0.5, 0.2), review: true };
    const list = measures(["1", flagged], ["2", shifted], ["3"]);

    const { edit } = ok(planRenumber(list, [byLabel(list, "1")], "2", "midi", "shift"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: undefined, 2: box(0.1, 0.2), 3: shifted });
  });

  it("clears the review flag of a box swapped onto another measure", () => {
    const list = measures(["1", { ...box(0.1, 0.2), review: true }], ["3", box(0.5, 0.2)]);

    const { edit } = ok(planRenumber(list, [byLabel(list, "1")], "3", "midi", "swap"));

    expect(layoutsAfter(list, edit)).toEqual({ 1: box(0.5, 0.2), 3: box(0.1, 0.2) });
  });

  it("does nothing when a box keeps its label", () => {
    const list = measures(["1", box(0.1, 0.2)]);

    expect(isEmptyMeasureEdit(ok(planRenumber(list, list, "1", "midi")).edit)).toBe(true);
  });
});

describe("planNewBox", () => {
  it("splits a box over consecutive beat map measures", () => {
    const list = measures(["1"], ["2"], ["3"]);

    const planned = ok(planNewBox(list, { page: 0, x: 0, y: 0, width: 0.4, height: 0.1 }, { count: 2, start: "2", beats: 4 }, "midi"));

    expect(layoutsAfter(list, planned.edit)).toEqual({
      1: undefined,
      2: { page: 0, x: 0, y: 0, width: 0.2, height: 0.1 },
      3: { page: 0, x: 0.2, y: 0, width: 0.2, height: 0.1 },
    });
    expect(getPlannedLabels(list, planned)).toEqual(["2", "3"]);
  });

  it("does not run past the end of the beat map", () => {
    const list = measures(["1"], ["2"]);

    expect(planNewBox(list, box(0, 0), { count: 3, start: "1", beats: 4 }, "midi").status).toBe("invalid");
  });

  it("creates audio measures and shifts the boxes in the way", () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.2, 0.2)], ["3", box(0.3, 0.2)]);

    expect(planNewBox(list, box(0.15, 0.2), { count: 1, start: "2", beats: 3 }, "audio").status).toBe("conflict");
    const planned = ok(planNewBox(list, box(0.15, 0.2), { count: 1, start: "2", beats: 3 }, "audio", "shift"));

    expect(layoutsAfter(list, planned.edit)).toEqual({ 1: box(0.1, 0.2), 2: box(0.15, 0.2), 3: box(0.2, 0.2), 4: box(0.3, 0.2) });
    expect(planned.edit.additions).toEqual([{ label: "4", beats: 3, layout: box(0.3, 0.2), index: 3 }]);
    expect(planned.boxes).toEqual([{ measure: "m2" }]);
  });

  it("creates a measure at the reading order position of its box", () => {
    const list = measures(["1", box(0.1, 0.2)], ["3", box(0.5, 0.2)], ["4"]);

    const between = ok(planNewBox(list, box(0.3, 0.2), { count: 1, start: "2", beats: 4 }, "audio"));
    const first = ok(planNewBox(list, box(0.0, 0.1), { count: 1, start: "0", beats: 4 }, "audio"));

    expect(between.edit.additions.map(addition => addition.index)).toEqual([1]);
    expect(between.boxes).toEqual([{ addition: 0 }]);
    expect(first.edit.additions.map(addition => addition.index)).toEqual([0]);
  });

  it("appends measures to a score without boxes", () => {
    const list = measures(["1"], ["2"]);

    const planned = ok(planNewBox(list, box(0.1, 0.2), { count: 2, start: "7", beats: 4 }, "audio"));

    expect(planned.edit.additions.map(addition => [addition.label, addition.index])).toEqual([["7", 2], ["8", 3]]);
    expect(planned.boxes).toEqual([{ addition: 0 }, { addition: 1 }]);
  });
});

describe("planAddMeasures", () => {
  it("places new measures among the existing ones by their labels", () => {
    const list = measures(["1"], ["2"], ["4"], ["5"]);

    const { edit } = planAddMeasures(list, ["3", "4a", "Coda"], 3);

    expect(edit.additions).toEqual([
      { label: "3", beats: 3, index: 2 },
      { label: "4a", beats: 3, index: 4 },
      { label: "Coda", beats: 3, index: 6 },
    ]);
  });

  it("finds labels the song already has", () => {
    expect(findExistingLabels(measures(["1"], ["2"]), ["2", "3"])).toEqual(["2"]);
  });
});

describe("bulk edits", () => {
  it("shows mixed beats as empty and only changes the ones that differ", () => {
    const list = measures(["1", undefined, 3], ["2", undefined, 4]);

    expect(getCommonBeats(list)).toBeUndefined();
    expect(getCommonBeats([list[0]!])).toBe(3);
    expect([...planBeats(list, 4).edit.beats]).toEqual([["m1", 4]]);
  });

  it("groups unplaced measures into runs in score order", () => {
    const list = measures(["1"], ["2"], ["3", box(0, 0)], ["4"]);

    expect(getUnplacedRuns(list).map(run => [run.first.label, run.last.label, run.count])).toEqual([["1", "2", 2], ["4", "4", 1]]);
  });

  it("removes the boxes of measures and boxes without a number in one edit", () => {
    const list = measures(["1", box(0, 0)], ["2", box(0.2, 0)]);
    const unnumbered = [box(0.4, 0), box(0.6, 0)];

    const { edit } = planRemoveBoxes(list, [{ ...unnumbered[0]! }], unnumbered);

    expect([...edit.layouts]).toEqual([["m1", undefined], ["m2", undefined]]);
    expect(edit.unnumberedBoxes).toEqual([unnumbered[1]]);
    expect(changesPlayback(edit)).toBe(false);
  });

  it("keeps the boxes without a number when none is selected", () => {
    expect(planRemoveBoxes(measures(["1", box(0, 0)])).edit.unnumberedBoxes).toBeUndefined();
  });

  it("deletes measures together with boxes without a number", () => {
    const list = measures(["1", box(0, 0)]);
    const unnumbered = [box(0.4, 0), box(0.6, 0)];

    const { edit } = planDeleteMeasures(list, unnumbered, unnumbered);

    expect(edit.removals).toEqual(["m1"]);
    expect(edit.unnumberedBoxes).toEqual([]);
  });

  it("moves boxes and keeps them selected", () => {
    const list = measures(["1", box(0, 0)]);

    const planned = planLayouts([[list[0]!, box(0.2, 0)]]);

    expect([...planned.edit.layouts]).toEqual([["m1", box(0.2, 0)]]);
    expect(planned.boxes).toEqual([{ measure: "m1" }]);
  });
});

describe("applying planned edits", () => {
  it("lets a new measure inside a span join it", async () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.3, 0.2)], ["3", box(0.5, 0.2)]);
    const song = makeAudioSong(list);

    const planned = ok(planNewBox(song.getMeasures(), box(0.4, 0.2), { count: 1, start: "2a", beats: 4 }, "audio"));
    await song.applyMeasureEdit(planned.edit);

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m3" }]);
    expect(playedLabels(song)).toEqual(["1", "2", "2a", "3"]);
  });

  it("extends the last span that ends right before a new measure", async () => {
    const list = measures(["1", box(0.1, 0.2)], ["2", box(0.3, 0.2)]);
    const song = makeAudioSong(list, [{ from: "m1", to: "m2" }, { from: "m2", to: "m2" }]);

    const planned = ok(planNewBox(song.getMeasures(), box(0.5, 0.2), { count: 1, start: "3", beats: 4 }, "audio"));
    await song.applyMeasureEdit(planned.edit);

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m2" }, { from: "m2", to: "m3" }]);
  });

  it("gives a song without measures one span over its first measure", async () => {
    const song = makeAudioSong();

    const planned = ok(planNewBox(song.getMeasures(), box(0.1, 0.2), { count: 1, start: "1", beats: 4 }, "audio"));
    const added = await song.applyMeasureEdit(planned.edit);

    expect(added.map(measure => measure.label)).toEqual(["1"]);
    expect(song.getRecording()).toEqual([{ from: added[0]!.id, to: added[0]!.id }]);
  });

  it("keeps references when a measure is relabeled instead of created", async () => {
    const song = makeAudioSongWithCut();
    const id = idOf(song, "3");

    const planned = ok(planRenumber(song.getMeasures(), [song.findMeasure(id)!], "3a", "audio"));
    await song.applyMeasureEdit(planned.edit);

    expect(song.findMeasure(id)!.label).toBe("3a");
    expect(song.getSections()).toHaveLength(1);
    expect(song.getWarpMarkers()).toHaveLength(2);
  });

  it("removes every reference to a deleted measure and takes it out of the recording", async () => {
    const song = makeAudioSongWithRepeat();
    const measure = song.findMeasureByLabel("3")!;

    await song.applyMeasureEdit(planDeleteMeasures([measure]).edit);

    expect(song.getSections()).toEqual([]);
    expect(song.getWarpMarkers().map(marker => marker.measure)).toEqual([idOf(song, "1")]);
    expect(playedLabels(song)).toEqual(["1", "2", "2", "2", "4"]);
  });

  it("only moves boxes in MIDI songs", async () => {
    const song = makeMidiSong();
    const [first, second] = song.getMeasures();

    const planned = ok(planRenumber(song.getMeasures(), [first!], second!.label, "midi", "swap"));
    await song.applyMeasureEdit(planned.edit);

    expect(planned.edit.additions).toEqual([]);
    expect(song.findMeasure(second!.id)!.layout).toBeDefined();
  });
});
