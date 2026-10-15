import { describe, expect, it } from "vitest";

import Measure, { MeasureList } from "./measure";
import Song from "./song";
import { constrainWarpMarkerTime, getWarpMarkerCandidates, MIN_WARP_MARKER_GAP } from "./warpEditing";

function makeSong(): Song {
  const measures = new MeasureList(["1", "2", "3", "4", "5"].map(value => new Measure(value, 4)));
  return new Song("song-id", "1", "Song", undefined, undefined, undefined, ["mix.mp3"], [], measures, undefined, [
    { measure: "2", time: 2 },
    { measure: "4", time: 6 },
  ]);
}

describe("getWarpMarkerCandidates", () => {
  it("offers the measures between the surrounding markers", () => {
    expect(getWarpMarkerCandidates(makeSong(), 1, 10)).toEqual(["1"]);
    expect(getWarpMarkerCandidates(makeSong(), 4, 10)).toEqual(["3"]);
    expect(getWarpMarkerCandidates(makeSong(), 8, 10)).toEqual(["5"]);
  });

  it("offers nothing at the very start, the end or on top of a marker", () => {
    expect(getWarpMarkerCandidates(makeSong(), 0, 10)).toEqual([]);
    expect(getWarpMarkerCandidates(makeSong(), 10, 10)).toEqual([]);
    expect(getWarpMarkerCandidates(makeSong(), 2, 10)).toEqual([]);
  });

  it("offers several measures in a wide gap", () => {
    const song = new Song("s", "1", "S", undefined, undefined, undefined, ["a.mp3"], [], new MeasureList(["1", "2", "3"].map(v => new Measure(v, 4))));

    expect(getWarpMarkerCandidates(song, 5, 10)).toEqual(["1", "2", "3"]);
  });
});

describe("constrainWarpMarkerTime", () => {
  it("keeps a marker between its neighbours", () => {
    const song = makeSong();

    expect(constrainWarpMarkerTime(song, "4", 1, 10)).toBeCloseTo(2 + MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(song, "4", 12, 10)).toBeCloseTo(10 - MIN_WARP_MARKER_GAP);
    expect(constrainWarpMarkerTime(song, "2", 4, 10)).toBe(4);
    expect(constrainWarpMarkerTime(song, "2", 7, 10)).toBeCloseTo(6 - MIN_WARP_MARKER_GAP);
  });
});
