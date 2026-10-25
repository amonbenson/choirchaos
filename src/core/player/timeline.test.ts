import { describe, expect, it } from "vitest";

import WarpMap from "@/core/midi/warp";
import Measure from "@/core/models/measure";
import { expandRecording } from "@/core/models/recording";
import type { MTIMidiJson } from "@/core/scripts/jsonTypes/mti";
import { BEAT_MAP_LABELS, idOf, makeAudioSongWithBakedVamp, makeMidiSong, makeMidiSongWithBakedVamp, makeMtiJson, positionTick, TICKS } from "@/test/fixtures";

import {
  buildBeatEvents,
  findLocationAt,
  getBeatTick,
  getLocationTick,
  groupPositionsByMeasure,
  resolveAudioTimeline,
  resolveMidiTimeline,
} from "./timeline";

type MtiEvent = MTIMidiJson["score"]["events"][number];

function beatMapOf(bars: [label: string, beats: number][], ticksPerBeat = 100): MTIMidiJson {
  const events: MtiEvent[] = [];
  let tick = 0;
  for (const [label, beats] of bars) {
    for (let beat = 1; beat <= beats; beat++) {
      events.push({ tickcount: tick, type: "BEAT", value: { meas: label, beat, tick: 0 } });
      tick += ticksPerBeat;
    }
  }

  return { score: { ...makeMtiJson().score, events } };
}

describe("resolveMidiTimeline", () => {
  it("times every position with its beat map bar", () => {
    const song = makeMidiSong();
    const timeline = resolveMidiTimeline(song.getTimeline(), makeMtiJson());

    expect(timeline.map(p => p.beatTicks[0])).toEqual([TICKS.measure0, TICKS.measure1, TICKS.measure2, TICKS.measure3, TICKS.measure4]);
    expect(timeline.at(-1)!.endTick).toBe(TICKS.duration);
    expect(timeline[0]!.beats).toBe(1);
    expect(timeline[1]!.beatTicks).toEqual([480, 960, 1440, 1920]);
  });

  it("gives baked passes their own ticks", () => {
    const song = makeMidiSongWithBakedVamp();
    const timeline = resolveMidiTimeline(song.getTimeline(), makeMtiJson(BEAT_MAP_LABELS.bakedVamp));

    const measure2 = idOf(song, "2");
    expect(timeline.filter(p => p.measure === measure2).map(p => [p.occurrence, p.beatTicks[0]])).toEqual([
      [1, positionTick(2)],
      [2, positionTick(3)],
      [3, positionTick(4)],
      [4, positionTick(5)],
    ]);
  });

  it("fails when the beat map and the recording differ in length", () => {
    const song = makeMidiSongWithBakedVamp();
    expect(() => resolveMidiTimeline(song.getTimeline(), makeMtiJson())).toThrow("The beat map has 5 measures, but the recording plays 8.");
  });

  it("takes the beats of a later occurrence from its own bar", () => {
    // Like "153-1" with 1 beat followed by "153-2" with 2 beats: the measure keeps the first occurrence's beat.
    const measures = [new Measure("m1", "152", 4), new Measure("m2", "153", 1), new Measure("m3", "154", 4)];
    const timeline = expandRecording(measures, [{ from: "m1", to: "m2" }, { from: "m2", to: "m3" }]);
    const resolved = resolveMidiTimeline(timeline, beatMapOf([["152", 4], ["153-1", 1], ["153-2", 2], ["154", 4], ["155", 1]]));

    expect(resolved[2]).toMatchObject({ measure: "m2", occurrence: 2, beats: 2, beatTicks: [500, 600], endTick: 700 });
    expect(getLocationTick(resolved, { measure: "m2", occurrence: 2, beat: 1 })).toBe(600);
    expect(findLocationAt(resolved, 650)).toEqual({ position: 2, measure: "m2", occurrence: 2, beat: 1 });
  });
});

describe("resolveAudioTimeline", () => {
  it("places positions between warp markers on measure occurrences", () => {
    const song = makeAudioSongWithBakedVamp();
    const timeline = resolveAudioTimeline(song.getTimeline(), song.getMeasures(), song.getWarpMarkers(), new WarpMap());

    expect(timeline.map(p => p.beatTicks[0])).toEqual([0, 250, 500, 750, 1000, 1250, 1500]);
    expect(timeline[1]!.beatTicks).toEqual([250, 312.5, 375, 437.5]);
    expect(timeline.at(-1)!.endTick).toBe(1750);
  });

  it("drops warp markers on occurrences the recording does not play", () => {
    const song = makeAudioSongWithBakedVamp();
    const markers = [...song.getWarpMarkers(), { measure: idOf(song, "2"), occurrence: 9, time: 9 }];
    const warpMap = new WarpMap();
    resolveAudioTimeline(song.getTimeline(), song.getMeasures(), markers, warpMap);

    expect(warpMap.getMarkers()).toEqual([{ position: 0, time: 0 }, { position: 2, time: 0.5 }]);
  });
});

describe("timeline helpers", () => {
  const song = makeMidiSongWithBakedVamp();
  const timeline = resolveMidiTimeline(song.getTimeline(), makeMtiJson(BEAT_MAP_LABELS.bakedVamp));
  const measure2 = idOf(song, "2");

  it("finds the location playing at a tick", () => {
    expect(findLocationAt(timeline, positionTick(4) + 500)).toEqual({ position: 4, measure: measure2, occurrence: 3, beat: 1 });
    expect(findLocationAt([], 0)).toBeUndefined();
  });

  it("finds the tick of a location by occurrence and clamps beats to the bar", () => {
    expect(getLocationTick(timeline, { measure: measure2, occurrence: 4, beat: 2 })).toBe(positionTick(5) + 960);
    expect(getLocationTick(timeline, { measure: measure2, occurrence: 4, beat: 9 })).toBe(positionTick(5) + 1440);
    expect(getLocationTick(timeline, { measure: measure2, occurrence: 5, beat: 0 })).toBeUndefined();
  });

  it("treats the beat after the last one as the end of the position", () => {
    expect(getBeatTick(timeline[2]!, 4)).toBe(positionTick(3));
  });

  it("builds one beat event per beat with its position", () => {
    const events = buildBeatEvents(timeline).items();
    expect(events).toHaveLength(1 + 4 * 7);
    expect(events[1]).toMatchObject({ tick: positionTick(1), position: 1, beat: 0 });
    expect(events.at(-1)).toMatchObject({ tick: positionTick(7) + 1440, position: 7, beat: 3 });
  });

  it("groups positions by measure", () => {
    expect(groupPositionsByMeasure(timeline).get(measure2)).toEqual([2, 3, 4, 5]);
  });
});
