import { describe, expect, it } from "vitest";

import type { MTIMidiJson } from "@/core/midi/mtiJson";
import { makeMtiJson, TRACK_NAMES } from "@/test/fixtures";

import { isBeatMap, readBeatMapBars, scoreFromBeatMap, tracksFromBeatMap, writtenLabel } from "./beatMap";

type MtiEvent = MTIMidiJson["score"]["events"][number];
type Bar = string | [label: string, beats: number];

const TICKS_PER_BEAT = 480;
const DEFAULT_BEATS = 4;
const TERMINAL_LABEL = "end";

/** A beat map that plays the bars in order, followed by a one-beat terminal bar. */
function beatMapOf(bars: readonly Bar[]): MTIMidiJson {
  const events: MtiEvent[] = [];
  let tick = 0;

  for (const bar of [...bars, [TERMINAL_LABEL, 1] as Bar]) {
    const [label, beats] = typeof bar === "string" ? [bar, DEFAULT_BEATS] : bar;
    for (let beat = 1; beat <= beats; beat++) {
      events.push({ tickcount: tick, type: "BEAT", value: { meas: label, beat, tick: 0 } });
      tick += TICKS_PER_BEAT;
    }
  }

  return { ...makeMtiJson(), score: { ...makeMtiJson().score, events } };
}

function labelsOf(bars: readonly Bar[]): string[] {
  return scoreFromBeatMap(beatMapOf(bars)).measures.map(m => m.label);
}

function spansOf(bars: readonly Bar[]): string[] {
  const { measures, recording } = scoreFromBeatMap(beatMapOf(bars));
  const label = (id: string): string => measures.find(m => m.id === id)!.label;
  return recording.map(span => `${label(span.from)}..${label(span.to)}`);
}

describe("beat map", () => {
  it("recognizes beat maps and rejects other JSON", () => {
    expect(isBeatMap(makeMtiJson())).toBe(true);
    expect(isBeatMap({ score: { events: [] } })).toBe(false);
    expect(isBeatMap([])).toBe(false);
    expect(isBeatMap(null)).toBe(false);
  });

  it.each([
    ["12", "12"],
    ["12-1", "12"],
    ["12-2", "12"],
    ["28A-1", "28A"],
    ["28A", "28A"],
    ["1R", "1"],
    ["1RR", "1"],
    ["8a", "8a"],
    ["Coda", "Coda"],
    ["A-B", "A-B"],
    ["-1", "-1"],
    ["R", "R"],
    ["AR", "AR"],
  ])("reads the beat map label %s as the written label %s", (beatMapLabel, written) => {
    expect(writtenLabel(beatMapLabel)).toBe(written);
  });

  it("builds measures with IDs in order of first appearance and drops the terminal bar", () => {
    const { measures } = scoreFromBeatMap(makeMtiJson());

    expect(measures.map(m => [m.id, m.label, m.beats])).toEqual([
      ["m1", "0", 1],
      ["m2", "1", 4],
      ["m3", "2", 4],
      ["m4", "3", 4],
      ["m5", "4", 4],
    ]);
  });

  it.each<[string, Bar[], string[], string[]]>([
    ["straight through", ["1", "2", "3", "4"], ["1", "2", "3", "4"], ["1..4"]],
    ["N-k repeats over several measures", ["1", "2-1", "3-1", "2-2", "3-2", "2-3", "3-3", "4"], ["1", "2", "3", "4"], ["1..3", "2..3", "2..4"]],
    ["a repeat mark", ["1", "2", "2R", "3"], ["1", "2", "3"], ["1..2", "2..3"]],
    ["R and RR repeat marks", ["1", "2", "1R", "2R", "1RR", "2RR", "3"], ["1", "2", "3"], ["1..2", "1..2", "1..3"]],
    ["first and second endings", ["1", "2", "3", "4a", "1-2", "2-2", "3-2", "4b", "5"], ["1", "2", "3", "4a", "4b", "5"], ["1..4a", "1..3", "4b..5"]],
    ["D.S. al coda", ["1", "2", "3", "4", "5", "6", "2-2", "3-2", "Coda", "7"], ["1", "2", "3", "4", "5", "6", "Coda", "7"], ["1..6", "2..3", "Coda..7"]],
    ["labels with letters and repeats", ["28", "28A-1", "28B-1", "28A-2", "28B-2", "29"], ["28", "28A", "28B", "29"], ["28..28B", "28A..29"]],
    ["unknown labels", ["Intro", "A", "B", "Intro"], ["Intro", "A", "B"], ["Intro..B", "Intro..Intro"]],
    ["a vamp recorded back to back", ["1", "2-1", "2-2", "2-3", "3"], ["1", "2", "3"], ["1..2", "2..2", "2..3"]],
    ["a measure played before its written predecessor", ["2", "1", "2-2"], ["2", "1"], ["2..1", "2..2"]],
  ])("builds the score and recording for %s", (_, bars, labels, spans) => {
    expect(labelsOf(bars)).toEqual(labels);
    expect(spansOf(bars)).toEqual(spans);
  });

  it("gives a measure the beats of its first appearance", () => {
    const { measures } = scoreFromBeatMap(beatMapOf(["152", ["153-1", 1], ["153-2", 2], "154"]));

    expect(measures.map(m => [m.label, m.beats])).toEqual([
      ["152", 4],
      ["153", 1],
      ["154", 4],
    ]);
  });

  it("starts a new bar whenever the label changes and counts its highest beat", () => {
    const bars = readBeatMapBars(beatMapOf([["1", 3], "1-2", ["2", 2]]));

    expect(bars.map(({ label, beats }) => ({ label, beats }))).toEqual([
      { label: "1", beats: 3 },
      { label: "1-2", beats: 4 },
      { label: "2", beats: 2 },
    ]);
  });

  it("times every beat and ends each bar where the next one starts", () => {
    const bars = readBeatMapBars(beatMapOf([["1", 2], ["2", 1]]));

    expect(bars.map(({ beatTicks, endTick }) => ({ beatTicks, endTick }))).toEqual([
      { beatTicks: [0, TICKS_PER_BEAT], endTick: 2 * TICKS_PER_BEAT },
      { beatTicks: [2 * TICKS_PER_BEAT], endTick: 3 * TICKS_PER_BEAT },
    ]);
  });

  it("reads beat events in tick order and ignores other events", () => {
    const beatMap = beatMapOf(["1", "2", "3"]);
    beatMap.score.events.reverse();
    beatMap.score.events.push({ tickcount: 0, type: "TEMPO", value: { bpm: 100, ticksPerQuarter: 600000 } });

    expect(scoreFromBeatMap(beatMap).measures.map(m => m.label)).toEqual(["1", "2", "3"]);
  });

  it("builds no measures and no recording from a beat map with only the terminal bar", () => {
    expect(scoreFromBeatMap(beatMapOf([]))).toEqual({ measures: [], recording: [] });
  });

  it("creates tracks named exactly like the MIDI tracks", () => {
    const tracks = tracksFromBeatMap(makeMtiJson());

    expect(tracks.map(t => [t.title, t.classification])).toEqual([
      [TRACK_NAMES.instrument, "Accompaniment"],
      [TRACK_NAMES.vocals, "Vocal"],
    ]);
  });
});
