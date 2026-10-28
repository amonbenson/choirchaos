import { describe, expect, it } from "vitest";

import type Measure from "@/core/models/measure";
import type { StoredWarpMarker } from "@/core/models/recording";
import { type Section, validateSections, type VampOut } from "@/core/models/sections";
import { cut, followJumps, repeat, toTimeline, vamp } from "@/test/route";

import WarpMap from "../midi/warp";
import Route, { type RouteState } from "./route";
import { findPositionAt, resolveAudioTimeline, type TimelinePosition } from "./timeline";

/*
 * Bars 70 to 73 of the Urinetown prelude. The audio plays them three times and then 70, 71, 72 and the
 * second ending 74, so its fourth pass is incomplete. The editor cuts that incomplete pass, so a vamp
 * that leaves after its last recorded pass goes straight on to 74.
 */
const AUDIO = ["69", ...repeatBars(3), "70", "71", "72", "74", "75"];

/** The four passes as they were stored before the recording was corrected, with only the first pass synced. */
const STORED_BEFORE = ["69", ...repeatBars(4), "74", "75"];

const PASS_STARTS_S = [133.305, 139.04, 144.72, 150.44];
const SECOND_ENDING_S = 154.715;

const SYNC_POINTS: StoredWarpMarker[] = [
  { measure: "69", occurrence: 1, time: 131.876 },
  ...PASS_STARTS_S.map((time, i) => ({ measure: "70", occurrence: i + 1, time })),
  { measure: "74", occurrence: 1, time: SECOND_ENDING_S },
  { measure: "75", occurrence: 1, time: 156.256 },
];

/** Positions of the passes in `AUDIO`. P4 is the incomplete pass 70, 71, 72. */
const P1 = 1;
const P2 = 5;
const P3 = 9;
const P4 = 13;
const SECOND_ENDING = 16;

const MS = 1000;

function repeatBars(times: number): string[] {
  return Array.from({ length: times }, () => ["70", "71", "72", "73"]).flat();
}

function toMeasures(labels: readonly string[]): Measure[] {
  return [...new Set(labels)].map(id => ({ id, label: id, beats: 4 }) as unknown as Measure);
}

function resolve(labels: readonly string[], syncPoints: readonly StoredWarpMarker[]): TimelinePosition[] {
  return resolveAudioTimeline(toTimeline(labels), toMeasures(labels), syncPoints, new WarpMap());
}

/** A vamp over the passes of 70 to 73, starting in pass `occurrence`. */
function vampOn(occurrence = 1, out: VampOut = "onEnd"): Section {
  return vamp("70", "73", { occurrence, out });
}

/** The incomplete fourth pass. */
const CUT_INCOMPLETE_PASS = cut("70", "72", 4);

function seconds(tick: number): number {
  return tick / MS;
}

function start(timeline: TimelinePosition[], position: number, beat = 0): number {
  return timeline[position]!.beatTicks[beat]!;
}

/** The positions the real jumps land on, following the route from `tick`. */
function jumpTargets(timeline: TimelinePosition[], route: Route, tick: number, count: number, state = route.stateAt(tick)): number[] {
  return followJumps(route, tick, count, state).map(([, to]) => findPositionAt(timeline, to)!.position);
}

describe("Pass timing of a recorded repeat", () => {
  it("spreads unsynced later passes evenly, which puts them early in this recording", () => {
    const onlyFirstSynced = [SYNC_POINTS[0]!, SYNC_POINTS[1]!, ...SYNC_POINTS.slice(-2)];
    const timeline = resolve(STORED_BEFORE, onlyFirstSynced);
    const errors = [P1, P2, P3, P4].map((position, i) => seconds(start(timeline, position)) - PASS_STARTS_S[i]!);
    [0, -0.38, -0.71, -1.08].forEach((expected, i) => expect(errors[i]).toBeCloseTo(expected, 2));
  });

  it("places every pass where the audio plays it once each pass is synced", () => {
    const timeline = resolve(AUDIO, SYNC_POINTS);
    [P1, P2, P3, P4].forEach((position, i) => expect(seconds(start(timeline, position))).toBeCloseTo(PASS_STARTS_S[i]!, 3));
    expect(seconds(start(timeline, SECOND_ENDING))).toBeCloseTo(SECOND_ENDING_S, 3);
  });
});

describe("Vamp over a recorded repeat with a cut incomplete pass", () => {
  const timeline = resolve(AUDIO, SYNC_POINTS);
  const sections = (out: VampOut = "onEnd"): Section[] => [vampOn(1, out), CUT_INCOMPLETE_PASS];

  it("is a valid arrangement", () => {
    expect(validateSections(toMeasures(AUDIO), toTimeline(AUDIO), sections())).toEqual([]);
  });

  it("counts the three complete passes and not the incomplete one", () => {
    const route = new Route(timeline, sections(), { vampsEnabled: true });
    expect(route.getSections()[0]!.passes.map(pass => pass.first)).toEqual([P1, P2, P3]);
  });

  it("loops the pass before the last while it is held", () => {
    const route = new Route(timeline, sections(), { vampsEnabled: true });
    expect(jumpTargets(timeline, route, start(timeline, P1), 3)).toEqual([P2, P2, P2]);
  });

  it("moves into the last recorded pass at the next beat after a late release and then skips the incomplete pass", () => {
    const route = new Route(timeline, sections(), { vampsEnabled: true });
    const released: RouteState = { section: 0, pass: 2, released: true };
    const pastMidpoint = start(timeline, P2 + 3, 1);
    // Released in the last measure of the pass, it finishes that measure in the last recorded pass, never another full pass.
    expect(jumpTargets(timeline, route, pastMidpoint, 2, released)).toEqual([P3 + 3, SECOND_ENDING]);
  });

  it("makes the looped pass the last one when released past its midpoint, switching at the next barline", () => {
    const route = new Route(timeline, sections(), { vampsEnabled: true });
    const released: RouteState = { section: 0, pass: 2, released: true };
    const thirdMeasure = start(timeline, P2 + 2, 1);
    expect(jumpTargets(timeline, route, thirdMeasure, 2, released)).toEqual([P3 + 3, SECOND_ENDING]);
  });

  it("jumps into the last recorded pass at a barline when released before the midpoint", () => {
    const route = new Route(timeline, sections(), { vampsEnabled: true });
    const released: RouteState = { section: 0, pass: 2, released: true };
    expect(jumpTargets(timeline, route, start(timeline, P2, 1), 2, released)).toEqual([P3 + 1, SECOND_ENDING]);
  });

  it.each(["anyBar", "anyBeat"] as const)("leaves with out = %s straight to the second ending", (out) => {
    const route = new Route(timeline, sections(out), { vampsEnabled: true });
    const released: RouteState = { section: 0, pass: 1, released: true };
    expect(jumpTargets(timeline, route, start(timeline, P1, 1), 2, released)).toEqual([SECOND_ENDING]);
  });

  it("plays everything as recorded except the incomplete pass while vamps are disabled", () => {
    const route = new Route(timeline, sections(), { vampsEnabled: false });
    expect(jumpTargets(timeline, route, 0, 5)).toEqual([SECOND_ENDING]);
  });
});

describe("Sections on different passes of a recorded repeat", () => {
  const timeline = resolve(AUDIO, SYNC_POINTS);
  const measures = toMeasures(AUDIO);
  const recording = toTimeline(AUDIO);

  it("cuts only the pass the cut is placed on", () => {
    const route = new Route(timeline, [cut("70", "73", 1)], { vampsEnabled: true });
    expect(route.getSections()[0]!.passes.map(pass => pass.first)).toEqual([P1]);
    expect(jumpTargets(timeline, route, 0, 5)).toEqual([P2]);
  });

  it("cuts several passes when the cut spans them", () => {
    const route = new Route(timeline, [cut("70", "73", 1, 2)], { vampsEnabled: true });
    expect(jumpTargets(timeline, route, 0, 5)).toEqual([P3]);
  });

  it("allows a cut on the first pass and a vamp from the second pass on", () => {
    const sections = [cut("70", "73", 1), vampOn(2)];
    expect(validateSections(measures, recording, sections)).toEqual([]);

    const route = new Route(timeline, sections, { vampsEnabled: true });
    expect(route.getSections()[1]!.passes.map(pass => pass.first)).toEqual([P2, P3]);
  });

  it("stops a vamp's recorded passes where another section starts", () => {
    const sections = [vampOn(1), cut("70", "73", 3)];
    expect(validateSections(measures, recording, sections)).toEqual([]);

    const route = new Route(timeline, sections, { vampsEnabled: true });
    expect(route.getSections()[0]!.passes.map(pass => pass.first)).toEqual([P1, P2]);
  });

  it("stops a repeat's recorded passes where another section starts", () => {
    const sections = [repeat("70", "73", 2), vampOn(3)];
    expect(validateSections(measures, recording, sections)).toEqual([]);

    const route = new Route(timeline, sections, { vampsEnabled: true });
    expect(route.getSections()[0]!.passes.map(pass => pass.first)).toEqual([P1, P2]);
    expect(route.getSections()[1]!.passes.map(pass => pass.first)).toEqual([P3]);
  });

  it("still rejects two sections on the same pass", () => {
    const [issue] = validateSections(measures, recording, [vampOn(2), cut("71", "72", 2)]);
    expect(issue?.reason).toBe("Sections must not overlap.");
  });
});
