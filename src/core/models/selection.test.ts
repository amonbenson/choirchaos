import { describe, expect, it, vi } from "vitest";

import { idOf, locationOf, makeAudioSong, makeAudioSongWithRepeat, makeMidiSong, makeMidiSongWithRepeat } from "@/test/fixtures";

import { addMarker } from "./markers";
import { createEmptyMeasureEdit } from "./measure";
import {
  findMeasureRuns,
  isBoxSelected,
  isSectionSelected,
  NO_SELECTION,
  pickRun,
  resolveSelection,
  selectMeasureRange,
  selectMeasures,
  toggleBox,
  toggleMeasure,
} from "./selection";
import type Song from "./song";

function ids(song: Song, ...labels: string[]): string[] {
  return labels.map(label => idOf(song, label));
}

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

const BOX = { page: 0, x: 0.8, y: 0.8, width: 0.1, height: 0.1 };
const OTHER_BOX = { ...BOX, x: 0.6 };

describe("selecting measures", () => {
  it("toggles measures and anchors a range at the last one toggled", () => {
    const song = makeMidiSong();
    const one = toggleMeasure(NO_SELECTION, idOf(song, "1"));
    const two = toggleMeasure(one, idOf(song, "3"));

    expect(two).toEqual({ kind: "measures", ids: ids(song, "1", "3"), anchor: idOf(song, "3") });
    expect(toggleMeasure(two, idOf(song, "1"))).toEqual(selectMeasures(ids(song, "3"), idOf(song, "1")));
    expect(toggleMeasure(selectMeasures(ids(song, "1")), idOf(song, "1"))).toEqual(NO_SELECTION);
  });

  it("selects the range from the anchor in reading order", () => {
    const song = makeMidiSong();

    expect(selectMeasureRange(song.getMeasures(), selectMeasures(ids(song, "3")), idOf(song, "1"))).toEqual({
      kind: "measures",
      ids: ids(song, "1", "2", "3"),
      anchor: idOf(song, "3"),
    });
  });

  it("starts over when another kind is selected", () => {
    const song = makeMidiSong();
    const section = { kind: "section", from: locationOf(song, "1") } as const;

    expect(toggleMeasure(section, idOf(song, "2"))).toEqual(selectMeasures(ids(song, "2")));
    expect(selectMeasureRange(song.getMeasures(), section, idOf(song, "2"))).toEqual(selectMeasures(ids(song, "2")));
    expect(toggleBox(selectMeasures(ids(song, "2")), BOX)).toEqual({ kind: "boxes", boxes: [BOX] });
  });

  it("toggles boxes without a number by position", () => {
    const both = toggleBox(toggleBox(NO_SELECTION, BOX), OTHER_BOX);

    expect(isBoxSelected(both, { ...BOX })).toBe(true);
    expect(toggleBox(toggleBox(both, BOX), OTHER_BOX)).toEqual(NO_SELECTION);
  });
});

describe("resolveSelection", () => {
  it("looks up placed measures in reading order", () => {
    const song = makeMidiSong();

    expect(resolveSelection(song, selectMeasures(ids(song, "3", "1")))).toMatchObject({ kind: "measures", measures: [{ label: "1" }, { label: "3" }] });
  });

  it("leaves nothing selected once the objects are gone", async () => {
    const song = makeAudioSong();
    const selection = selectMeasures(ids(song, "2"));
    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), removals: [idOf(song, "2")] });

    expect(resolveSelection(song, selection)).toEqual(NO_SELECTION);
    expect(resolveSelection(song, { kind: "boxes", boxes: [BOX] })).toEqual(NO_SELECTION);
    expect(resolveSelection(song, { kind: "section", from: locationOf(song, "1") })).toEqual(NO_SELECTION);
    expect(resolveSelection(song, { kind: "pass", index: 5 })).toEqual(NO_SELECTION);
  });

  it("finds a section by its start, a marker by its place and name, and a sync point by its occurrence", async () => {
    const song = makeAudioSongWithRepeat();
    const marker = { at: locationOf(song, "2", 1, 2), text: "A" };
    await song.editLayers({ markers: addMarker(song.getMarkers(), marker) });
    const [section] = song.getSections();
    const [warpMarker] = song.getWarpMarkers();

    expect(resolveSelection(song, { kind: "section", from: { ...section!.from } })).toEqual({ kind: "section", section });
    expect(isSectionSelected({ kind: "section", from: { ...section!.from } }, section!)).toBe(true);
    expect(resolveSelection(song, { kind: "marker", marker: { at: { ...marker.at }, text: "A" } })).toEqual({ kind: "marker", marker });
    expect(resolveSelection(song, { kind: "marker", marker: { at: marker.at, text: "B" } })).toEqual(NO_SELECTION);
    expect(resolveSelection(song, { kind: "syncPoint", occurrence: { measure: warpMarker!.measure, occurrence: warpMarker!.occurrence } }))
      .toEqual({ kind: "syncPoint", warpMarker });
    expect(resolveSelection(song, { kind: "pass", index: 1 })).toMatchObject({ kind: "pass", index: 1, stretch: { occurrence: 2 } });
  });
});

describe("findMeasureRuns", () => {
  it("finds every pass that plays the measures back to back", () => {
    const song = makeMidiSongWithRepeat();

    expect(findMeasureRuns(song.getMeasures(), song.getTimeline(), ids(song, "2", "3"))).toEqual([
      { first: 2, last: 3 },
      { first: 4, last: 5 },
      { first: 6, last: 7 },
    ]);
  });

  it("has no runs for measures that never play next to each other", () => {
    const song = makeMidiSong();

    expect(findMeasureRuns(song.getMeasures(), song.getTimeline(), ids(song, "1", "3"))).toEqual([]);
    expect(findMeasureRuns(song.getMeasures(), song.getTimeline(), [])).toEqual([]);
  });

  it("reads a run that crosses a jump in the recording", () => {
    const song = makeMidiSongWithRepeat();

    expect(findMeasureRuns(song.getMeasures(), song.getTimeline(), ids(song, "3", "4"))).toEqual([{ first: 7, last: 8 }]);
  });
});

describe("pickRun", () => {
  const runs = [{ first: 2, last: 3 }, { first: 4, last: 5 }, { first: 6, last: 7 }];

  it("takes the run the playhead is in, else the closest one", () => {
    expect(pickRun(runs, 5)).toBe(runs[1]);
    expect(pickRun(runs, 8)).toBe(runs[2]);
    expect(pickRun(runs, 0)).toBe(runs[0]);
  });

  it("takes the first run without a playhead", () => {
    expect(pickRun(runs, undefined)).toBe(runs[0]);
    expect(pickRun([], 3)).toBeUndefined();
  });
});
