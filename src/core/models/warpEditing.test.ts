import { describe, expect, it } from "vitest";

import { idOf, makeAudioSong, makeAudioSongWithBakedVamp, makeAudioSongWithRepeat } from "@/test/fixtures";

import { formatOccurrenceShort } from "./locationFormat";
import { getRecordingStretches, type Occurrence, type StoredWarpMarker, type TimelineEntry } from "./recording";
import type Song from "./song";
import {
  canPlaceWarpMarker,
  constrainWarpMarkerTime,
  findUnsyncedRepeatPasses,
  formatSyncTime,
  getOccurrenceKey,
  getPositionedWarpMarkers,
  getReassignCandidates,
  getSyncedOccurrences,
  getSyncStatus,
  getWarpMarkerCandidates,
  LARGE_NUDGE_STEP,
  MAX_MEASURES_PER_SYNC_POINT,
  MIN_WARP_MARKER_GAP,
  NUDGE_STEP,
  nudgeWarpMarkerTime,
  parseSyncTime,
} from "./warpEditing";

const DURATION = 10;

function marker(song: Song, label: string, occurrence: number, time: number): StoredWarpMarker {
  return { measure: idOf(song, label), occurrence, time };
}

function describeEntries(song: Song, entries: TimelineEntry[]): string[] {
  return entries.map(entry => formatOccurrenceShort(song.findMeasure(entry.measure)!.label, entry.occurrence));
}

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

describe("nudging", () => {
  // Positions: 0 "1", 1 to 4 "2" (four recorded passes), 5 "3", 6 "4".
  const song = makeAudioSongWithBakedVamp();
  const timeline = song.getTimeline();
  const markers = [marker(song, "2", 1, 1), marker(song, "2", 3, 3), marker(song, "3", 1, 5)];
  const third = { measure: idOf(song, "2"), occurrence: 3 };

  it("moves a marker by the step", () => {
    expect(nudgeWarpMarkerTime(timeline, markers, third, 3, NUDGE_STEP, DURATION)).toBeCloseTo(3.01);
    expect(nudgeWarpMarkerTime(timeline, markers, third, 3, -LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(2.9);
  });

  it("nudges on from a time that is not saved yet", () => {
    expect(nudgeWarpMarkerTime(timeline, markers, third, 3.5, NUDGE_STEP, DURATION)).toBeCloseTo(3.51);
  });

  it("stops at the neighbouring occurrences", () => {
    expect(nudgeWarpMarkerTime(timeline, markers, third, 1.05, -LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(1 + MIN_WARP_MARKER_GAP);
    expect(nudgeWarpMarkerTime(timeline, markers, third, 4.95, LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(5 - MIN_WARP_MARKER_GAP);
  });
});

describe("sync times", () => {
  it("formats minutes, seconds and milliseconds", () => {
    expect(formatSyncTime(52.14)).toBe("0:52.140");
    expect(formatSyncTime(65.0004)).toBe("1:05.000");
    expect(formatSyncTime(59.9999)).toBe("1:00.000");
    expect(formatSyncTime(-1)).toBe("0:00.000");
  });

  it("reads what it formats and plain seconds", () => {
    expect(parseSyncTime(formatSyncTime(83.25))).toBeCloseTo(83.25);
    expect(parseSyncTime(" 52,5 ")).toBeCloseTo(52.5);
    expect(parseSyncTime("1:05")).toBe(65);
    expect(parseSyncTime("125")).toBe(125);
  });

  it("rejects what is not a time", () => {
    expect(parseSyncTime("")).toBeUndefined();
    expect(parseSyncTime("1:75")).toBeUndefined();
    expect(parseSyncTime("-3")).toBeUndefined();
    expect(parseSyncTime("abc")).toBeUndefined();
  });
});

describe("placing and reassigning", () => {
  const song = makeAudioSongWithBakedVamp();
  const timeline = song.getTimeline();
  const markers = [marker(song, "2", 1, 1), marker(song, "2", 3, 3), marker(song, "3", 1, 5)];
  const at = (label: string, occurrence: number): Occurrence => ({ measure: idOf(song, label), occurrence });

  it("places an occurrence only between its neighbours", () => {
    expect(canPlaceWarpMarker(timeline, markers, at("2", 2), 2, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, markers, at("2", 2), 4, DURATION)).toBe(false);
    expect(canPlaceWarpMarker(timeline, markers, at("2", 2), 1, DURATION)).toBe(false);
  });

  it("ignores the occurrence's own marker", () => {
    expect(canPlaceWarpMarker(timeline, markers, at("2", 3), 4.5, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, markers, at("2", 3), 5.5, DURATION)).toBe(false);
  });

  it("lets the first position sit at the start, and rejects what is not played", () => {
    expect(canPlaceWarpMarker(timeline, markers, at("1", 1), 0, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, markers, at("2", 9), 2, DURATION)).toBe(false);
    expect(canPlaceWarpMarker(timeline, [], at("4", 1), DURATION + 1, DURATION)).toBe(false);
  });

  it("offers the free occurrences between a marker's neighbours", () => {
    expect(describeEntries(song, getReassignCandidates(timeline, markers, at("2", 3), DURATION))).toEqual(["2 (2nd)", "2 (4th)"]);
    expect(describeEntries(song, getReassignCandidates(timeline, markers, at("3", 1), DURATION))).toEqual(["2 (4th)", "4"]);
  });

  it("offers the measures before the next marker to a marker at the very start", () => {
    const atStart = [marker(song, "2", 2, 0), marker(song, "3", 1, 5)];

    expect(describeEntries(song, getReassignCandidates(timeline, atStart, at("2", 2), DURATION))).toEqual(["1", "2", "2 (3rd)", "2 (4th)"]);
  });

  it("offers nothing for an occurrence without a marker", () => {
    expect(getReassignCandidates(timeline, markers, at("4", 1), DURATION)).toEqual([]);
  });
});

describe("sync status", () => {
  // Positions 0 to 7 play "1 2 3 2 3 2 3 4" in the spans 1 to 3, 2 to 3, 2 to 4.
  const song = makeAudioSongWithRepeat();
  const timeline = song.getTimeline();
  const passes = getRecordingStretches(song.getMeasures(), song.getRecording());

  it("names the passes without a sync point", () => {
    const status = getSyncStatus(timeline, [marker(song, "1", 1, 0), marker(song, "3", 3, 3)], passes);

    expect(status.count).toBe(2);
    expect(status.unsyncedPasses).toEqual([{ first: 3, last: 4 }]);
  });

  it("counts every pass covered with one sync point each", () => {
    const markers = [marker(song, "1", 1, 0), marker(song, "2", 2, 1), marker(song, "2", 3, 2)];

    expect(getSyncStatus(timeline, markers, passes).unsyncedPasses).toEqual([]);
  });

  it("finds repeated passes without a sync point at their start", () => {
    const inside = [marker(song, "1", 1, 0), marker(song, "3", 2, 1), marker(song, "2", 3, 2)];

    expect(findUnsyncedRepeatPasses(timeline, inside, passes).map(pass => pass.first)).toEqual([3]);
    expect(findUnsyncedRepeatPasses(timeline, [marker(song, "1", 1, 0)], passes).map(pass => pass.first)).toEqual([3, 5]);
  });

  it("does not ask for a sync point at the start of the first pass", () => {
    expect(findUnsyncedRepeatPasses(timeline, [marker(song, "2", 2, 1), marker(song, "2", 3, 2)], passes)).toEqual([]);
  });

  it("names stretches with too many measures per sync point", () => {
    const long = Array.from({ length: 3 * MAX_MEASURES_PER_SYNC_POINT }, (_, position) => ({ position, measure: "m1", occurrence: position + 1 }));
    const markers = [{ measure: "m1", occurrence: 3, time: 1 }, { measure: "m1", occurrence: 4, time: 2 }];

    expect(getSyncStatus(long, markers, []).gaps).toEqual([{ first: 3, last: long.length - 1, length: long.length - 3 }]);
    expect(getSyncStatus(long, [], []).gaps).toEqual([{ first: 0, last: long.length - 1, length: long.length }]);
  });

  it("finds no gaps in a short recording", () => {
    expect(getSyncStatus(timeline, [], passes).gaps).toEqual([]);
    expect(getSyncStatus([], [], []).gaps).toEqual([]);
  });

  it("groups the synced occurrences by measure", () => {
    const markers = [marker(song, "2", 3, 3), marker(song, "1", 1, 0), marker(song, "2", 1, 1), marker(song, "4", 2, 4)];

    expect(getSyncedOccurrences(timeline, markers)).toEqual(new Map([[idOf(song, "1"), [1]], [idOf(song, "2"), [1, 3]]]));
  });
});
