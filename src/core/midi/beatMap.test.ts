import { describe, expect, it } from "vitest";

import { makeMtiJson, TRACK_NAMES } from "@/test/fixtures";

import { isBeatMap, measuresFromBeatMap, tracksFromBeatMap } from "./beatMap";

describe("beat map", () => {
  it("recognizes beat maps and rejects other JSON", () => {
    expect(isBeatMap(makeMtiJson())).toBe(true);
    expect(isBeatMap({ score: { events: [] } })).toBe(false);
    expect(isBeatMap([])).toBe(false);
    expect(isBeatMap(null)).toBe(false);
  });

  it("creates one measure per beat map measure with its beat count", () => {
    const measures = measuresFromBeatMap(makeMtiJson());

    expect(measures.map(m => [m.value, m.beats])).toEqual([
      ["0", 1],
      ["1", 4],
      ["2", 4],
      ["3", 4],
      ["4", 4],
      ["5", 1],
    ]);
  });

  it("creates tracks named exactly like the MIDI tracks", () => {
    const tracks = tracksFromBeatMap(makeMtiJson());

    expect(tracks.map(t => [t.title, t.classification])).toEqual([
      [TRACK_NAMES.instrument, "Accompaniment"],
      [TRACK_NAMES.vocals, "Vocal"],
    ]);
  });
});
