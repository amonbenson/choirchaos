import { describe, expect, it } from "vitest";

import { idOf, makeAudioSong, makeAudioSongWithBakedVamp, makeAudioSongWithRepeat } from "@/test/fixtures";

import { formatOccurrenceShort } from "./locationFormat";
import Measure from "./measure";
import { type Occurrence, type StoredWarpMarker, type TimelineEntry } from "./recording";
import type Song from "./song";
import {
  addSyncPoint,
  canPlaceWarpMarker,
  constrainWarpMarkerTime,
  countSyncPoints,
  findMeterChangesToSync,
  formatSyncTime,
  getOccurrenceKey,
  getPositionedSyncPoints,
  getPositionedWarpMarkers,
  getReassignCandidates,
  getSyncedOccurrences,
  getWarpMarkerCandidates,
  isRecordingEnd,
  LARGE_NUDGE_STEP,
  MIN_WARP_MARKER_GAP,
  moveSyncPoint,
  NUDGE_STEP,
  nudgeWarpMarkerTime,
  parseSyncTime,
  RECORDING_END,
  removeSyncPoint,
  type SyncPlace,
  type SyncPoints,
} from "./warpEditing";

const DURATION = 10;

function marker(song: Song, label: string, occurrence: number, time: number): StoredWarpMarker {
  return { measure: idOf(song, label), occurrence, time };
}

function points(warpMarkers: StoredWarpMarker[], endSyncTime?: number): SyncPoints {
  return { warpMarkers, endSyncTime };
}

function describeEntries(song: Song, entries: SyncPlace[]): string[] {
  return entries.map(entry => isRecordingEnd(entry) ? entry : formatOccurrenceShort(song.findMeasure(entry.measure)!.label, entry.occurrence));
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
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 1, DURATION))).toEqual(["1"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 4, DURATION))).toEqual(["3"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 8, DURATION))).toEqual(["end"]);
  });

  it("offers nothing at the very start, the end or on top of a marker", () => {
    expect(getWarpMarkerCandidates(timeline, points(markers), 0, DURATION)).toEqual([]);
    expect(getWarpMarkerCandidates(timeline, points(markers), DURATION, DURATION)).toEqual([]);
    expect(getWarpMarkerCandidates(timeline, points(markers), 2, DURATION)).toEqual([]);
  });

  it("offers every position without markers", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points([]), 5, DURATION))).toEqual(["1", "2", "3", "4", "end"]);
  });

  it("keeps a dragged marker between its neighbours", () => {
    const fourth = { measure: idOf(song, "4"), occurrence: 1 };
    const second = { measure: idOf(song, "2"), occurrence: 1 };

    expect(constrainWarpMarkerTime(timeline, points(markers), fourth, 1, DURATION)).toBeCloseTo(2 + MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, points(markers), fourth, 12, DURATION)).toBeCloseTo(DURATION - MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, points(markers), second, 4, DURATION)).toBe(4);
    expect(constrainWarpMarkerTime(timeline, points(markers), second, 7, DURATION)).toBeCloseTo(6 - MIN_WARP_MARKER_GAP);
  });

  it("lets the first marker reach the start of the recording", () => {
    const first = { measure: idOf(song, "1"), occurrence: 1 };

    expect(constrainWarpMarkerTime(timeline, points([marker(song, "1", 1, 1)]), first, -1, DURATION)).toBe(0);
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
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 2, DURATION))).toEqual(["2 (2nd)"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 4, DURATION))).toEqual(["2 (4th)"]);
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 7, DURATION))).toEqual(["4", "end"]);
  });

  it("offers every occurrence without markers", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points([]), 5, DURATION)))
      .toEqual(["1", "2", "2 (2nd)", "2 (3rd)", "2 (4th)", "3", "4", "end"]);
  });

  it("clamps a marker between the neighbouring occurrences of the same measure", () => {
    const third = { measure: idOf(song, "2"), occurrence: 3 };

    expect(constrainWarpMarkerTime(timeline, points(markers), third, 0, DURATION)).toBeCloseTo(1 + MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, points(markers), third, 9, DURATION)).toBeCloseTo(5 - MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, points(markers), third, 4, DURATION)).toBe(4);
  });

  it("leaves a marker that does not resolve unclamped", () => {
    expect(constrainWarpMarkerTime(timeline, points(markers), { measure: idOf(song, "2"), occurrence: 9 }, 42, DURATION)).toBe(42);
  });
});

describe("nudging", () => {
  // Positions: 0 "1", 1 to 4 "2" (four recorded passes), 5 "3", 6 "4".
  const song = makeAudioSongWithBakedVamp();
  const timeline = song.getTimeline();
  const markers = [marker(song, "2", 1, 1), marker(song, "2", 3, 3), marker(song, "3", 1, 5)];
  const third = { measure: idOf(song, "2"), occurrence: 3 };

  it("moves a marker by the step", () => {
    expect(nudgeWarpMarkerTime(timeline, points(markers), third, 3, NUDGE_STEP, DURATION)).toBeCloseTo(3.01);
    expect(nudgeWarpMarkerTime(timeline, points(markers), third, 3, -LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(2.9);
  });

  it("nudges on from a time that is not saved yet", () => {
    expect(nudgeWarpMarkerTime(timeline, points(markers), third, 3.5, NUDGE_STEP, DURATION)).toBeCloseTo(3.51);
  });

  it("stops at the neighbouring occurrences", () => {
    expect(nudgeWarpMarkerTime(timeline, points(markers), third, 1.05, -LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(1 + MIN_WARP_MARKER_GAP);
    expect(nudgeWarpMarkerTime(timeline, points(markers), third, 4.95, LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(5 - MIN_WARP_MARKER_GAP);
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
    expect(canPlaceWarpMarker(timeline, points(markers), at("2", 2), 2, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, points(markers), at("2", 2), 4, DURATION)).toBe(false);
    expect(canPlaceWarpMarker(timeline, points(markers), at("2", 2), 1, DURATION)).toBe(false);
  });

  it("ignores the occurrence's own marker", () => {
    expect(canPlaceWarpMarker(timeline, points(markers), at("2", 3), 4.5, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, points(markers), at("2", 3), 5.5, DURATION)).toBe(false);
  });

  it("lets the first position sit at the start, and rejects what is not played", () => {
    expect(canPlaceWarpMarker(timeline, points(markers), at("1", 1), 0, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, points(markers), at("2", 9), 2, DURATION)).toBe(false);
    expect(canPlaceWarpMarker(timeline, points([]), at("4", 1), DURATION + 1, DURATION)).toBe(false);
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

  function withBeats(...beats: number[]): { timeline: TimelineEntry[]; measures: Measure[] } {
    return {
      timeline: beats.map((_, position) => ({ position, measure: `m${position + 1}`, occurrence: 1 })),
      measures: beats.map((count, i) => new Measure(`m${i + 1}`, `${i + 1}`, count)),
    };
  }

  function syncAt(...positions: number[]): StoredWarpMarker[] {
    return positions.map(position => ({ measure: `m${position + 1}`, occurrence: 1, time: position }));
  }

  it("needs nothing beyond two sync points in a steady meter, repeats included", () => {
    expect(findMeterChangesToSync(timeline, song.getMeasures(), points([marker(song, "1", 1, 0), marker(song, "4", 1, 7)]))).toEqual([]);
  });

  it("names nothing before the song is synced", () => {
    const { timeline: changing, measures } = withBeats(4, 3, 4);

    expect(findMeterChangesToSync(changing, measures, points(syncAt(0)))).toEqual([]);
  });

  it("asks for a sync point at each meter change between sync points, one at a time", () => {
    const { timeline: changing, measures } = withBeats(4, 4, 3, 3, 4, 4);

    expect(findMeterChangesToSync(changing, measures, points(syncAt(0, 5)))).toEqual([2]);
    expect(findMeterChangesToSync(changing, measures, points(syncAt(0, 2, 5)))).toEqual([4]);
    expect(findMeterChangesToSync(changing, measures, points(syncAt(0, 2, 4, 5)))).toEqual([]);
  });

  it("names every stretch whose meter changes", () => {
    const { timeline: changing, measures } = withBeats(4, 3, 4, 4, 2, 4);

    expect(findMeterChangesToSync(changing, measures, points(syncAt(0, 3, 5)))).toEqual([1, 4]);
  });

  it("asks for the start once a pickup is synced but extrapolated", () => {
    const { timeline: pickup, measures } = withBeats(1, 4, 4, 4);

    expect(findMeterChangesToSync(pickup, measures, points(syncAt(1, 3)))).toEqual([0]);
    expect(findMeterChangesToSync(pickup, measures, points(syncAt(0, 1, 3)))).toEqual([]);
  });

  it("asks for the last measure when the meter changes at the last sync point", () => {
    const { timeline: ending, measures } = withBeats(4, 4, 2, 2);

    expect(findMeterChangesToSync(ending, measures, points(syncAt(0, 2)))).toEqual([3]);
    expect(findMeterChangesToSync(ending, measures, points(syncAt(0, 2, 3)))).toEqual([]);
  });

  it("groups the synced occurrences by measure", () => {
    const markers = [marker(song, "2", 3, 3), marker(song, "1", 1, 0), marker(song, "2", 1, 1), marker(song, "4", 2, 4)];

    expect(getSyncedOccurrences(timeline, markers)).toEqual(new Map([[idOf(song, "1"), [1]], [idOf(song, "2"), [1, 3]]]));
  });
});

describe("end sync point", () => {
  // Positions 0 to 3 play measures "1" to "4".
  const song = makeAudioSong();
  const timeline = song.getTimeline();
  const markers = [marker(song, "1", 1, 0), marker(song, "4", 1, 6)];

  it("sits one position after the last measure", () => {
    expect(getPositionedSyncPoints(timeline, points(markers, 8)).map(point => [point.position, point.time])).toEqual([[0, 0], [3, 6], [4, 8]]);
    expect(getPositionedSyncPoints([], points([], 8))).toEqual([]);
  });

  it("is offered after the last sync point until it exists", () => {
    expect(describeEntries(song, getWarpMarkerCandidates(timeline, points(markers), 7, DURATION))).toEqual(["end"]);
    expect(getWarpMarkerCandidates(timeline, points(markers, 8), 7, DURATION)).toEqual([]);
    expect(getWarpMarkerCandidates(timeline, points(markers, 8), 9, DURATION)).toEqual([]);
  });

  it("stays between the last sync point and the end of the audio", () => {
    expect(constrainWarpMarkerTime(timeline, points(markers, 8), RECORDING_END, 5, DURATION)).toBeCloseTo(6 + MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(timeline, points(markers, 8), RECORDING_END, 12, DURATION)).toBeCloseTo(DURATION - MIN_WARP_MARKER_GAP);
    expect(canPlaceWarpMarker(timeline, points(markers, 8), RECORDING_END, 9, DURATION)).toBe(true);
    expect(canPlaceWarpMarker(timeline, points(markers, 8), RECORDING_END, 6, DURATION)).toBe(false);
  });

  it("keeps the last measure's sync point before it", () => {
    const fourth = { measure: idOf(song, "4"), occurrence: 1 };

    expect(constrainWarpMarkerTime(timeline, points(markers, 8), fourth, 9, DURATION)).toBeCloseTo(8 - MIN_WARP_MARKER_GAP);
    expect(nudgeWarpMarkerTime(timeline, points(markers, 8), fourth, 7.95, LARGE_NUDGE_STEP, DURATION)).toBeCloseTo(8 - MIN_WARP_MARKER_GAP);
  });

  it("is added, moved and removed without touching the warp markers", () => {
    const added = addSyncPoint(timeline, points(markers), RECORDING_END, 8);

    expect(added).toEqual(points(markers, 8));
    expect(countSyncPoints(added)).toBe(3);
    expect(() => addSyncPoint(timeline, added, RECORDING_END, 9)).toThrow("already has");
    expect(() => addSyncPoint([], points([]), RECORDING_END, 9)).toThrow("no measures");
    expect(moveSyncPoint(added, RECORDING_END, 9)).toEqual(points(markers, 9));
    expect(removeSyncPoint(added, RECORDING_END)).toEqual(points(markers));
  });

  it("ends the stretch it closes, so the last measure needs no sync point of its own", () => {
    const changing = [4, 4, 2, 2].map((_, position) => ({ position, measure: `m${position + 1}`, occurrence: 1 }));
    const measures = [4, 4, 2, 2].map((beats, i) => new Measure(`m${i + 1}`, `${i + 1}`, beats));
    const start = { measure: "m1", occurrence: 1, time: 0 };
    const change = { measure: "m3", occurrence: 1, time: 2 };

    expect(findMeterChangesToSync(changing, measures, points([start, change]))).toEqual([3]);
    expect(findMeterChangesToSync(changing, measures, points([start, change], 3))).toEqual([]);
    expect(findMeterChangesToSync(changing, measures, points([start], 3))).toEqual([2]);
  });
});
