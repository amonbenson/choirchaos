import { describe, expect, it } from "vitest";

import { idOf, makeAudioSong, makeAudioSongWithBakedVamp } from "@/test/fixtures";

import type { StoredWarpMarker, TimelineEntry } from "./recording";
import type Song from "./song";
import {
  constrainWarpMarkerTime,
  formatOccurrence,
  formatOccurrenceShort,
  formatOrdinal,
  getOccurrenceKey,
  getPositionedWarpMarkers,
  getWarpMarkerCandidates,
  MIN_WARP_MARKER_GAP,
} from "./warpEditing";

const DURATION = 10;

function marker(song: Song, label: string, occurrence: number, time: number): StoredWarpMarker {
  return { measure: idOf(song, label), occurrence, time };
}

function describeEntries(song: Song, entries: TimelineEntry[]): string[] {
  return entries.map(entry => formatOccurrenceShort(song.findMeasure(entry.measure)!.label, entry.occurrence));
}

describe("formatOccurrence", () => {
  it("names the occurrence only when the measure has played before", () => {
    expect(formatOccurrence("12", 1)).toBe("12");
    expect(formatOccurrence("12", 2)).toBe("12, 2nd time");
    expect(formatOccurrenceShort("12", 3)).toBe("12 (3rd)");
  });

  it("uses English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(formatOrdinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });
});

describe("getOccurrenceKey", () => {
  it("differs between occurrences of one measure", () => {
    expect(getOccurrenceKey({ measure: "m2", occurrence: 1 })).not.toBe(getOccurrenceKey({ measure: "m2", occurrence: 2 }));
  });
});

describe("plain recording", () => {
  // Positions 0 to 3 play measures "1" to "4".
  const song = makeAudioSong();
  const timeline = song.getTimeline();
  const markers = [marker(song, "2", 1, 2), marker(song, "4", 1, 6)];

  it("offers the positions between the surrounding markers", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, markers, 1, DURATION))).toEqual(["1"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, markers, 4, DURATION))).toEqual(["3"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, markers, 8, DURATION))).toEqual([]);
  });

  it("offers nothing at the very start, the end or on top of a marker", () => {
    expect(getWarpMarkerCandidates(timeline, markers, 0, DURATION)).toEqual([]);
    expect(getWarpMarkerCandidates(timeline, markers, DURATION, DURATION)).toEqual([]);
    expect(getWarpMarkerCandidates(timeline, markers, 2, DURATION)).toEqual([]);
  });

  it("offers every position without markers", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, [], 5, DURATION))).toEqual(["1", "2", "3", "4"]);
  });

  it("keeps a dragged marker between its neighbours", () => {
    const fourth = { measure: idOf(song, "4"), occurrence: 1 };
    const second = { measure: idOf(song, "2"), occurrence: 1 };

    expect(constrainWarpMarkerTime(timeline, markers, fourth, 1, DURATION)).toBeCloseTo(2 + MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, markers, fourth, 12, DURATION)).toBeCloseTo(DURATION - MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, markers, second, 4, DURATION)).toBe(4);
    expect(constrainWarpMarkerTime(timeline, markers, second, 7, DURATION)).toBeCloseTo(6 - MIN_WARP_MARKER_GAP);
  });

  it("lets the first marker reach the start of the recording", () => {
    const first = { measure: idOf(song, "1"), occurrence: 1 };

    expect(constrainWarpMarkerTime(timeline, [marker(song, "1", 1, 1)], first, -1, DURATION)).toBe(0);
  });
});

describe("baked-pass recording", () => {
  // Positions: 0 "1", 1 to 4 "2" (four recorded passes), 5 "3", 6 "4".
  const song = makeAudioSongWithBakedVamp();
  const timeline = song.getTimeline();
  const markers = [marker(song, "2", 1, 1), marker(song, "2", 3, 3), marker(song, "3", 1, 5)];

  it("orders markers in timeline order, not in stored or score order", () => {
    const shuffled = [markers[2]!, markers[0]!, markers[1]!];

    expect(getPositionedWarpMarkers(timeline, shuffled).map(m => m.position)).toEqual([1, 3, 5]);
  });

  it("drops markers whose occurrence the recording does not play", () => {
    expect(getPositionedWarpMarkers(timeline, [marker(song, "2", 5, 4)])).toEqual([]);
  });

  it("offers the occurrences of one measure between the surrounding markers", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, markers, 2, DURATION))).toEqual(["2 (2nd)"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, markers, 4, DURATION))).toEqual(["2 (4th)"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, markers, 7, DURATION))).toEqual(["4"]);
  });

  it("offers every occurrence without markers", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, [], 5, DURATION)))
      .toEqual(["1", "2", "2 (2nd)", "2 (3rd)", "2 (4th)", "3", "4"]);
  });

  it("clamps a marker between the neighbouring occurrences of the same measure", () => {
    const third = { measure: idOf(song, "2"), occurrence: 3 };

    expect(constrainWarpMarkerTime(timeline, markers, third, 0, DURATION)).toBeCloseTo(1 + MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, markers, third, 9, DURATION)).toBeCloseTo(5 - MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, markers, third, 4, DURATION)).toBe(4);
  });

  it("leaves a marker that does not resolve unclamped", () => {
    expect(constrainWarpMarkerTime(timeline, markers, { measure: idOf(song, "2"), occurrence: 9 }, 42, DURATION)).toBe(42);
  });
});
