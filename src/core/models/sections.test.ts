import { describe, expect, it } from "vitest";

import { idOf, locationOf, makeMidiSong, makeMidiSongWithBakedVamp, makeMidiSongWithRepeat } from "@/test/fixtures";

import { deserializeMarker, serializeMarker } from "./markers";
import Measure from "./measure";
import { expandRecording, type Location } from "./recording";
import {
  createSection,
  deserializeSection,
  findNearestPosition,
  findSection,
  findSectionsAt,
  getSectionExtent,
  getSectionPasses,
  getSectionRun,
  holdsRun,
  type Section,
  serializeSection,
  toMeasureRange,
  validateSection,
  validateSections,
  withRun,
} from "./sections";

const SCORE = ["1", "2", "3", "4", "5"].map(label => new Measure(label, label, 4));

// Measures 2 and 3 are recorded three times.
const TIMELINE = expandRecording(SCORE, [
  { from: "1", to: "3" },
  { from: "2", to: "3" },
  { from: "2", to: "5" },
]);

function at(measure: string, beat = 0, occurrence = 1): Location {
  return { measure, beat, occurrence };
}

function cut(from: Location, to: Location): Section {
  return { kind: "cut", from, to };
}

function repeat(from: Location, to: Location, passes = 2): Section {
  return { kind: "repeat", from, to, passes };
}

describe("section defaults", () => {
  it("creates each kind with its defaults", () => {
    expect(createSection("cut", at("1"), at("1", 3))).toEqual({ kind: "cut", from: at("1"), to: at("1", 3) });
    expect(createSection("repeat", at("1"), at("1", 3))).toMatchObject({ kind: "repeat", passes: 2 });
    expect(createSection("vamp", at("1"), at("1", 3))).toEqual({ kind: "vamp", from: at("1"), to: at("1", 3), out: "onEnd", vocals: "all" });
  });
});

describe("section storage", () => {
  it("round-trips sections and stores first occurrences without the field", () => {
    const section: Section = { kind: "vamp", from: at("2", 0, 2), to: at("3", 3, 2), out: "anyBar", vocals: "split" };

    const stored = serializeSection(section);

    expect(stored).toEqual({ kind: "vamp", from: { measure: "2", beat: 0, occurrence: 2 }, to: { measure: "3", beat: 3, occurrence: 2 }, out: "anyBar", vocals: "split" });
    expect(serializeSection(cut(at("1"), at("1", 3)))).toEqual({ kind: "cut", from: { measure: "1", beat: 0 }, to: { measure: "1", beat: 3 } });
    expect(deserializeSection(stored)).toEqual(section);
  });

  it("round-trips markers", () => {
    const marker = { at: at("2", 1, 3), text: "Solo" };

    expect(serializeMarker({ at: at("2", 1), text: "Solo" })).toEqual({ at: { measure: "2", beat: 1 }, text: "Solo" });
    expect(deserializeMarker(serializeMarker(marker))).toEqual(marker);
  });
});

describe("validateSection", () => {
  it("accepts valid sections", () => {
    expect(validateSection(SCORE, TIMELINE, cut(at("1"), at("1", 3)))).toBeUndefined();
    expect(validateSection(SCORE, TIMELINE, { kind: "repeat", from: at("2"), to: at("3", 3), passes: 1 })).toBeUndefined();
    expect(validateSection(SCORE, TIMELINE, { ...createSection("vamp", at("4"), at("5", 3)) })).toBeUndefined();
  });

  it("rejects locations that do not resolve", () => {
    expect(validateSection(SCORE, TIMELINE, cut(at("9"), at("1", 3)))).toMatch(/does not exist/);
    expect(validateSection(SCORE, TIMELINE, cut(at("1"), at("1", 4)))).toMatch(/no beat 5/);
    expect(validateSection(SCORE, TIMELINE, cut(at("2", 0, 4), at("3", 3, 4)))).toMatch(/not played 4 times/);
  });

  it("rejects ranges that do not move forward", () => {
    expect(validateSection(SCORE, TIMELINE, cut(at("3"), at("2", 3)))).toMatch(/start before it ends/);
    expect(validateSection(SCORE, TIMELINE, cut(at("2", 1), at("2", 1)))).toMatch(/start before it ends/);
    expect(validateSection(SCORE, TIMELINE, cut(at("2", 0, 2), at("3", 3, 1)))).toMatch(/start before it ends/);
  });

  it("checks passes and vamp options", () => {
    const repeat = { kind: "repeat", from: at("1"), to: at("1", 3) } as const;
    const vamp = createSection("vamp", at("1"), at("1", 3));

    expect(validateSection(SCORE, TIMELINE, { ...repeat, passes: 0 })).toMatch(/at least 1/);
    expect(validateSection(SCORE, TIMELINE, { ...repeat, passes: 1.5 })).toMatch(/at least 1/);
    expect(validateSection(SCORE, TIMELINE, vamp)).toBeUndefined();
    expect(validateSection(SCORE, TIMELINE, { ...vamp, out: "never" } as unknown as Section)).toMatch(/out and vocals/);
    expect(validateSection(SCORE, TIMELINE, { ...vamp, vocals: "none" } as unknown as Section)).toMatch(/out and vocals/);
  });
});

describe("section extents and overlaps", () => {
  it("covers exactly the range of a cut", () => {
    expect(getSectionExtent(TIMELINE, [], cut(at("2", 1), at("3", 2)))).toEqual({
      from: { position: 1, beat: 1 },
      to: { position: 2, beat: 2 },
    });
    expect(getSectionExtent(TIMELINE, [], cut(at("2"), at("3", 3, 2)))).toEqual({
      from: { position: 1, beat: 0 },
      to: { position: 4, beat: 3 },
    });
    expect(getSectionExtent(TIMELINE, [], cut(at("9"), at("1")))).toBeUndefined();
  });

  it("covers all recorded passes of a repeat or vamp", () => {
    expect(getSectionExtent(TIMELINE, [], repeat(at("2"), at("3", 3)))).toEqual({
      from: { position: 1, beat: 0 },
      to: { position: 6, beat: 3 },
    });
  });

  it("stops the recorded passes where another section starts", () => {
    const later = cut(at("2", 0, 3), at("3", 3, 3));
    const first = repeat(at("2"), at("3", 3));

    expect(getSectionPasses(TIMELINE, [first, later], first)).toEqual([{ first: 1, last: 2 }, { first: 3, last: 4 }]);
    expect(getSectionPasses(TIMELINE, [first, later], later)).toEqual([{ first: 5, last: 6 }]);
    expect(validateSections(SCORE, TIMELINE, [first, later])).toEqual([]);
  });

  it("starts the recorded passes at the section's own pass", () => {
    const second = repeat(at("2", 0, 2), at("3", 3, 2));

    expect(getSectionPasses(TIMELINE, [second], second)).toEqual([{ first: 3, last: 4 }, { first: 5, last: 6 }]);
  });

  it("rejects two sections on the same pass", () => {
    const sections = [repeat(at("2", 0, 2), at("3", 3, 2)), cut(at("3", 0, 2), at("3", 3, 2))];

    expect(validateSections(SCORE, TIMELINE, sections)).toEqual([{ index: 1, reason: "Sections must not overlap." }]);
  });

  it("allows sections that touch without sharing a beat", () => {
    const sections = [cut(at("1"), at("1", 1)), cut(at("1", 2), at("1", 3))];

    expect(validateSections(SCORE, TIMELINE, sections)).toEqual([]);
  });

  it("reports invalid sections with their index", () => {
    expect(validateSections(SCORE, TIMELINE, [cut(at("1"), at("1", 3)), cut(at("9"), at("1"))])).toEqual([
      { index: 1, reason: "Measure 9 does not exist." },
    ]);
  });
});

describe("sections over runs of the recording", () => {
  it("finds the sections that share a played measure with a run and whether one holds it", () => {
    const song = makeMidiSongWithRepeat();
    const timeline = song.getTimeline();
    const [repeat] = song.getSections();

    expect(findSectionsAt(timeline, song.getSections(), { first: 5, last: 5 })).toEqual([repeat]);
    expect(holdsRun(timeline, song.getSections(), repeat!, { first: 5, last: 5 })).toBe(true);
    expect(holdsRun(timeline, song.getSections(), repeat!, { first: 7, last: 8 })).toBe(false);
    expect(findSectionsAt(timeline, song.getSections(), { first: 0, last: 1 })).toEqual([]);
  });

  it("counts the recorded passes of a section as part of it", () => {
    const song = makeMidiSongWithBakedVamp();

    expect(holdsRun(song.getTimeline(), song.getSections(), song.getSections()[0]!, { first: 4, last: 4 })).toBe(true);
  });

  it("finds a section by its start", () => {
    const song = makeMidiSongWithRepeat();

    expect(findSection(song.getSections(), locationOf(song, "2"))).toBe(song.getSections()[0]);
    expect(findSection(song.getSections(), locationOf(song, "2", 1))).toBeUndefined();
  });

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

  it("lands a range handle on the occurrence closest to where it started, inside its limits", () => {
    const song = makeMidiSongWithRepeat();
    const timeline = song.getTimeline();

    expect(findNearestPosition(timeline, idOf(song, "3"), 5, 0, 8)).toBe(5);
    expect(findNearestPosition(timeline, idOf(song, "3"), 8, 0, 8)).toBe(7);
    expect(findNearestPosition(timeline, idOf(song, "3"), 0, 0, 2)).toBeUndefined();
  });
});
