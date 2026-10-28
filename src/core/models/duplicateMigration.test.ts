import { afterEach, describe, expect, it, vi } from "vitest";

import { dbUpdate } from "@/pocketbase/db";
import { makeMidiSong } from "@/test/fixtures";

import { findDuplicateRuns, playDuplicatesAsRepeat, previewDuplicatesAsRepeat } from "./duplicateMigration";
import type { SongLayers } from "./layers";
import Measure, { type MeasureLayout } from "./measure";
import { findPosition, formatRecording, validateLocation } from "./recording";
import { validateSections } from "./sections";
import Song from "./song";

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

function lastSave(): Record<string, any> {
  return vi.mocked(dbUpdate).mock.calls.at(-1)![2];
}

function numbers(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}

function box(x: number): MeasureLayout {
  return { page: 0, x, y: 0.2, width: 0.1, height: 0.1 };
}

function flagged(x: number): MeasureLayout {
  return { ...box(x), review: true };
}

/**
 * Measures with the IDs "m1", "m2", ... played straight through, like the songs of the Durchs-Loch guide
 * after the migration. A measure named in `copies` gets the box of the measure it fakes a repeat of.
 */
function makeFakedRepeatSong(labels: string[], copies: Record<string, string>, layers: Partial<SongLayers> = {}): Song {
  const measures = labels.map((label, i) => new Measure(`m${i + 1}`, label, 4, { page: Math.floor(i / 20), x: (i % 20) / 20, y: 0.1, width: 0.05, height: 0.1 }));
  for (const measure of measures) {
    const original = copies[measure.label];
    if (original) {
      measure.layout = measures.find(other => other.label === original)!.layout;
    }
  }

  return new Song("song-id", "1", "Song", undefined, undefined, undefined, ["a.mp3"], [], { measures, spans: [{ from: "m1", to: `m${labels.length}` }], ...layers });
}

function expectValidLayers(song: Song): void {
  const timeline = song.getTimeline();
  const times = song.getWarpMarkers().map(marker => marker.time);

  expect(song.getWarpMarkers().every(marker => findPosition(timeline, marker) !== undefined)).toBe(true);
  expect(times.every((time, i) => i === 0 || time > times[i - 1]!)).toBe(true);
  expect(song.getMarkers().every(marker => !validateLocation(song.getMeasures(), timeline, marker.at))).toBe(true);
  expect(validateSections(song.getMeasures(), timeline, song.getSections())).toEqual([]);
}

function getIds(measures: readonly Measure[]): string[] {
  return measures.map(measure => measure.id);
}

async function playDetectedDuplicatesAsRepeat(song: Song): Promise<void> {
  const [run] = findDuplicateRuns(song.getMeasures());
  await playDuplicatesAsRepeat(song, getIds(run!.duplicates), getIds(run!.originals));
}

function labelsOf(measures: readonly Measure[]): string[] {
  return measures.map(measure => measure.label);
}

describe("findDuplicateRuns", () => {
  it("groups consecutive measures lying on consecutive earlier measures", () => {
    const measures = [
      new Measure("m1", "1", 4, box(0.1)),
      new Measure("m2", "2", 4, box(0.3)),
      new Measure("m3", "3", 4, box(0.5)),
      new Measure("m4", "1a", 4, box(0.1)),
      new Measure("m5", "2a", 4, flagged(0.3)),
      new Measure("m6", "4", 4, box(0.7)),
      new Measure("m7", "3a", 4, box(0.5)),
      new Measure("m8", "5", 4),
    ];

    const runs = findDuplicateRuns(measures);

    expect(runs.map(run => [labelsOf(run.duplicates), labelsOf(run.originals)])).toEqual([
      [["1a", "2a"], ["1", "2"]],
      [["3a"], ["3"]],
    ]);
  });

  it("splits a run where the originals do not follow each other", () => {
    const measures = [
      new Measure("m1", "1", 4, box(0.1)),
      new Measure("m2", "2", 4, box(0.3)),
      new Measure("m3", "3", 4, box(0.5)),
      new Measure("m4", "1a", 4, box(0.1)),
      new Measure("m5", "3a", 4, box(0.5)),
    ];

    expect(findDuplicateRuns(measures).map(run => labelsOf(run.duplicates))).toEqual([["1a"], ["3a"]]);
  });

  it("finds nothing when boxes only overlap partly", () => {
    const measures = [new Measure("m1", "1", 4, box(0.1)), new Measure("m2", "2", 4, box(0.12)), new Measure("m3", "3", 4)];

    expect(findDuplicateRuns(measures)).toEqual([]);
  });
});

describe("playing duplicates as a repeat", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("turns 8a to 8h of Durchs Loch und mittendrin into the second time of 1 to 8", async () => {
    const labels = [...numbers(1, 8), ..."abcdefgh".split("").map(letter => `8${letter}`), ...numbers(9, 106)];
    const copies = Object.fromEntries("abcdefgh".split("").map((letter, i) => [`8${letter}`, String(i + 1)]));
    const warpMarkers = [{ measure: "m1", occurrence: 1, time: 0.3315 }, { measure: "m114", occurrence: 1, time: 210.558 }];
    const song = makeFakedRepeatSong(labels, copies, { warpMarkers });
    const box = song.findMeasure("m1")!.layout;

    expect(findDuplicateRuns(song.getMeasures()).map(run => [labelsOf(run.duplicates), labelsOf(run.originals)])).toEqual([
      [["8a", "8b", "8c", "8d", "8e", "8f", "8g", "8h"], numbers(1, 8)],
    ]);

    await playDetectedDuplicatesAsRepeat(song);

    expect(song.getMeasures()).toHaveLength(106);
    expect(song.findMeasure("m9")).toBeUndefined();
    expect(song.findMeasure("m1")!.layout).toBe(box);
    expect(song.getRecording()).toEqual([{ from: "m1", to: "m8" }, { from: "m1", to: "m8" }, { from: "m17", to: "m114" }]);
    expect(song.getTimeline()).toHaveLength(114);
    expect(song.getWarpMarkers()).toEqual(warpMarkers);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(lastSave()).toEqual({ score: song.serialize().score, recording: song.serialize().recording });
    expectValidLayers(song);
  });

  it("turns 4a to 4d of Ohne Sorgen chill'n into the second time of 1 to 4", async () => {
    const labels = [...numbers(1, 4), "4a", "4b", "4c", "4d", ...numbers(5, 122)];
    const song = makeFakedRepeatSong(labels, { "4a": "1", "4b": "2", "4c": "3", "4d": "4" });

    await playDetectedDuplicatesAsRepeat(song);

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m4" }, { from: "m1", to: "m4" }, { from: "m9", to: "m126" }]);
    expectValidLayers(song);
  });

  it("gives an original without a box the box of its duplicate", async () => {
    const song = makeFakedRepeatSong(["1", "2", "1a"], { "1a": "1" });
    const box = song.findMeasure("m3")!.layout;
    await song.editLayers({ measures: song.getMeasures().map(m => m.id === "m1" ? new Measure("m1", "1", 4) : m) });

    await playDuplicatesAsRepeat(song, ["m3"], ["m1"]);

    expect(song.findMeasure("m1")!.layout).toEqual(box);
  });

  it("moves the warp marker and the vamp on 22 to 25 of It's A Privilege To Pee (Reprise) to the second time of 21A to 21D", async () => {
    const labels = [...numbers(1, 21), "21A", "21B", "21C", "21D", ...numbers(22, 30)];
    const song = makeFakedRepeatSong(labels, { 22: "21A", 23: "21B", 24: "21C", 25: "21D" }, {
      warpMarkers: [{ measure: "m1", occurrence: 1, time: 0 }, { measure: "m26", occurrence: 1, time: 32.62 }, { measure: "m34", occurrence: 1, time: 60 }],
      markers: [{ at: { measure: "m27", beat: 2, occurrence: 1 }, text: "Breath" }],
      sections: [{ kind: "vamp", from: { measure: "m26", beat: 0, occurrence: 1 }, to: { measure: "m29", beat: 1, occurrence: 1 }, out: "onEnd", vocals: "all" }],
    });
    const run = findDuplicateRuns(song.getMeasures())[0]!;

    const preview = previewDuplicatesAsRepeat(song, getIds(run.duplicates), getIds(run.originals));
    expect(formatRecording(preview.spans, song.getMeasures())).toBe("1-21D, 21A-21D, 26-30");
    expect(preview.length).toBe(34);
    expect(preview.dropped).toEqual({ warpMarkers: [], markers: [], sections: [] });

    await playDetectedDuplicatesAsRepeat(song);

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m25" }, { from: "m22", to: "m25" }, { from: "m30", to: "m34" }]);
    expect(song.getWarpMarkers()).toEqual([
      { measure: "m1", occurrence: 1, time: 0 },
      { measure: "m22", occurrence: 2, time: 32.62 },
      { measure: "m34", occurrence: 1, time: 60 },
    ]);
    expect(song.getMarkers()).toEqual([{ at: { measure: "m23", beat: 2, occurrence: 2 }, text: "Breath" }]);
    expect(song.getSections()).toEqual([{
      kind: "vamp",
      from: { measure: "m22", beat: 0, occurrence: 2 },
      to: { measure: "m25", beat: 1, occurrence: 2 },
      out: "onEnd",
      vocals: "all",
    }]);
    expect(Object.keys(lastSave())).toEqual(["score", "recording", "arrangement"]);
    expectValidLayers(song);
  });

  it("rejects duplicates that do not pair up with originals", async () => {
    const song = makeFakedRepeatSong(numbers(1, 4), { 3: "1" });

    expect(() => previewDuplicatesAsRepeat(song, ["m3", "m4"], ["m1"])).toThrow("exactly one original");
    expect(() => previewDuplicatesAsRepeat(song, ["m9"], ["m1"])).toThrow("does not exist");
    expect(() => previewDuplicatesAsRepeat(song, ["m3", "m1"], ["m1", "m2"])).toThrow("both");
    const midi = makeMidiSong();
    await expect(playDuplicatesAsRepeat(midi, [midi.getMeasures()[2]!.id], [midi.getMeasures()[1]!.id])).rejects.toThrow("beat map");
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
