import { describe, expect, it } from "vitest";

import type { MTIMidiJson } from "@/core/midi/mtiJson";
import WarpMap from "@/core/midi/warp";
import Measure from "@/core/models/measure";
import { expandRecording } from "@/core/models/recording";
import { BEAT_MAP_LABELS, idOf, makeAudioSongWithBakedVamp, makeMidiSong, makeMidiSongWithBakedVamp, makeMtiJson, positionTick, TICKS } from "@/test/fixtures";

import {
  buildAudioTempoEvents,
  buildBeatEvents,
  findLocationAt,
  getBeatTick,
  getLocationTick,
  resolveAudioTimeline,
  resolveMidiTimeline,
  type TimelinePosition,
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

/** Measures "1", "2", ... with the given beats, played once each and synced at `[position, seconds]`. */
function audioTimelineOf(beats: number[], sync: [position: number, time: number][], endSyncTime?: number): { timeline: TimelinePosition[]; warpMap: WarpMap } {
  const measures = beats.map((count, i) => new Measure(`m${i + 1}`, `${i + 1}`, count));
  const played = expandRecording(measures, [{ from: "m1", to: `m${beats.length}` }]);
  const warpMarkers = sync.map(([position, time]) => ({ measure: `m${position + 1}`, occurrence: 1, time }));
  const warpMap = new WarpMap();
  return { timeline: resolveAudioTimeline(played, measures, { warpMarkers, endSyncTime }, warpMap), warpMap };
}

describe("resolveAudioTimeline", () => {
  it("places positions between warp markers on measure occurrences", () => {
    const song = makeAudioSongWithBakedVamp();
    const timeline = resolveAudioTimeline(song.getTimeline(), song.getMeasures(), song.getSyncPoints(), new WarpMap());

    expect(timeline.map(p => p.beatTicks[0])).toEqual([0, 250, 500, 750, 1000, 1250, 1500]);
    expect(timeline[1]!.beatTicks).toEqual([250, 312.5, 375, 437.5]);
    expect(timeline.at(-1)!.endTick).toBe(1750);
  });

  it("drops warp markers on occurrences the recording does not play", () => {
    const song = makeAudioSongWithBakedVamp();
    const markers = [...song.getWarpMarkers(), { measure: idOf(song, "2"), occurrence: 9, time: 9 }];
    const warpMap = new WarpMap();
    resolveAudioTimeline(song.getTimeline(), song.getMeasures(), { warpMarkers: markers, endSyncTime: undefined }, warpMap);

    expect(warpMap.getMarkers()).toEqual([{ beat: 0, time: 0 }, { beat: 8, time: 0.5 }]);
  });

  it("ends the last measure at the end sync point instead of extrapolating", () => {
    const song = makeAudioSongWithBakedVamp();
    const timeline = resolveAudioTimeline(song.getTimeline(), song.getMeasures(), { ...song.getSyncPoints(), endSyncTime: 3.5 }, new WarpMap());

    expect(timeline.map(p => p.beatTicks[0])).toEqual([0, 250, 500, 1100, 1700, 2300, 2900]);
    expect(timeline.at(-1)!.endTick).toBe(3500);
  });

  it("gives every measure between sync points time in proportion to its beats", () => {
    const { timeline } = audioTimelineOf([12, 6, 12], [[0, 0]], 15);

    expect(timeline.map(p => [p.beatTicks[0], p.endTick])).toEqual([[0, 6000], [6000, 9000], [9000, 15000]]);
    expect(timeline[1]!.beatTicks).toEqual([6000, 6500, 7000, 7500, 8000, 8500]);
  });

  it("goes on at the beat rate of the nearest sync points beyond them", () => {
    const { timeline } = audioTimelineOf([2, 4, 4, 3], [[1, 1], [2, 3]]);

    expect(timeline.map(p => [p.beatTicks[0], p.endTick])).toEqual([[0, 1000], [1000, 3000], [3000, 5000], [5000, 6500]]);
  });

  it("plays half a second per beat until two sync points set the rate", () => {
    expect(audioTimelineOf([4, 3], []).timeline.map(p => p.endTick)).toEqual([2000, 3500]);
    expect(audioTimelineOf([4, 3], [[1, 5]]).timeline.map(p => p.endTick)).toEqual([5000, 6500]);
  });
});

describe("buildAudioTempoEvents", () => {
  it("plays the beats between two sync points at one tempo, whatever their measures", () => {
    const { warpMap } = audioTimelineOf([4, 2, 4, 4], [[0, 0], [2, 2]], 4);

    expect(buildAudioTempoEvents(warpMap).items().map(e => [e.tick, e.bpm])).toEqual([[0, 180], [2000, 240]]);
  });

  it("adds no event where the tempo stays the same", () => {
    const { warpMap } = audioTimelineOf([4, 4, 4], [[1, 1], [2, 2]]);

    expect(buildAudioTempoEvents(warpMap).items().map(e => [e.tick, e.bpm])).toEqual([[0, 240]]);
  });

  it("starts at the default tempo without sync points", () => {
    const { warpMap } = audioTimelineOf([4], []);

    expect(buildAudioTempoEvents(warpMap).items().map(e => [e.tick, e.bpm])).toEqual([[0, 120]]);
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
});
