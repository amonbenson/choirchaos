import { describe, expect, it } from "vitest";

import { idOf, locationOf, makeMidiSong, makeMidiSongWithBakedVamp, makeMidiSongWithRepeat } from "@/test/fixtures";

import {
  findNearestPosition,
  findSectionsAt,
  findSelectedRuns,
  formatSectionName,
  getSectionRun,
  pickRun,
  toMeasureRange,
  withRun,
} from "./measureSelection";
import type Song from "./song";

function ids(song: Song, ...labels: string[]): Set<string> {
  return new Set(labels.map(label => idOf(song, label)));
}

describe("findSelectedRuns", () => {
  it("finds every pass that plays the selected measures back to back", () => {
    const song = makeMidiSongWithRepeat();

    expect(findSelectedRuns(song.getMeasures(), song.getTimeline(), ids(song, "2", "3"))).toEqual([
      { first: 2, last: 3 },
      { first: 4, last: 5 },
      { first: 6, last: 7 },
    ]);
    expect(findSelectedRuns(song.getMeasures(), song.getTimeline(), ids(song, "3"))).toEqual([
      { first: 3, last: 3 },
      { first: 5, last: 5 },
      { first: 7, last: 7 },
    ]);
  });

  it("has no runs for measures that never play next to each other", () => {
    const song = makeMidiSong();

    expect(findSelectedRuns(song.getMeasures(), song.getTimeline(), ids(song, "1", "3"))).toEqual([]);
    expect(findSelectedRuns(song.getMeasures(), song.getTimeline(), new Set())).toEqual([]);
  });

  it("reads a run that crosses a jump in the recording", () => {
    const song = makeMidiSongWithRepeat();

    expect(findSelectedRuns(song.getMeasures(), song.getTimeline(), ids(song, "3", "4"))).toEqual([{ first: 7, last: 8 }]);
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

describe("findSectionsAt", () => {
  it("tells whether a section is the run, holds it or only overlaps it", () => {
    const song = makeMidiSongWithRepeat();
    const timeline = song.getTimeline();
    const [repeat] = song.getSections();

    expect(findSectionsAt(timeline, song.getSections(), { first: 2, last: 3 })).toEqual([{ index: 0, section: repeat, relation: "equal" }]);
    expect(findSectionsAt(timeline, song.getSections(), { first: 5, last: 5 })).toEqual([{ index: 0, section: repeat, relation: "contains" }]);
    expect(findSectionsAt(timeline, song.getSections(), { first: 7, last: 8 })).toEqual([{ index: 0, section: repeat, relation: "overlaps" }]);
    expect(findSectionsAt(timeline, song.getSections(), { first: 0, last: 1 })).toEqual([]);
  });

  it("counts the recorded passes of a section as part of it", () => {
    const song = makeMidiSongWithBakedVamp();

    expect(findSectionsAt(song.getTimeline(), song.getSections(), { first: 4, last: 4 })[0]?.relation).toBe("contains");
  });
});

describe("measure ranges", () => {
  it("covers whole measures of the run's occurrences", () => {
    const song = makeMidiSongWithRepeat();

    expect(toMeasureRange(song.getMeasures(), song.getTimeline(), { first: 4, last: 5 })).toEqual({
      from: locationOf(song, "2", 0, 2),
      to: locationOf(song, "3", 3, 2),
    });
  });

  it("snaps a section that starts mid-measure, keeping its settings", () => {
    const song = makeMidiSong();
    const section = { kind: "repeat" as const, from: locationOf(song, "1", 2), to: locationOf(song, "2", 1), passes: 3 };

    expect(withRun(song.getMeasures(), song.getTimeline(), section, { first: 1, last: 3 })).toEqual({
      kind: "repeat", from: locationOf(song, "1"), to: locationOf(song, "3", 3), passes: 3,
    });
    expect(getSectionRun(song.getTimeline(), section)).toEqual({ first: 1, last: 2 });
  });
});

describe("findNearestPosition", () => {
  it("lands on the occurrence closest to where a handle started, inside its limits", () => {
    const song = makeMidiSongWithRepeat();
    const timeline = song.getTimeline();

    expect(findNearestPosition(timeline, idOf(song, "3"), 5, 0, 8)).toBe(5);
    expect(findNearestPosition(timeline, idOf(song, "3"), 8, 0, 8)).toBe(7);
    expect(findNearestPosition(timeline, idOf(song, "3"), 0, 0, 2)).toBeUndefined();
  });
});

describe("formatSectionName", () => {
  it("names the kind, the measures and an occurrence after the first", () => {
    const song = makeMidiSongWithRepeat();
    const [repeat] = song.getSections();

    expect(formatSectionName(song.getMeasures(), repeat!)).toBe("Repeat 2 to 3");
    expect(formatSectionName(song.getMeasures(), { kind: "cut", from: locationOf(song, "2", 0, 2), to: locationOf(song, "2", 3, 2) }))
      .toBe("Cut 2, 2nd time");
  });
});
