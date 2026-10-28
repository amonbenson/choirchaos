import { describe, expect, it } from "vitest";

import type { Location } from "@/core/models/recording";
import type { Section, VampOut, VampVocals } from "@/core/models/sections";
import { BEATS, followJumps, makeTimeline, playPositions, POSITION_TICKS } from "@/test/route";

import Route, { type RouteState } from "./route";

/*
 * Measures 2 and 3 recorded three times, then a fourth pass that only plays 2 before the ending 4, like a
 * written repeat whose last time through takes another ending. Every position is 400 ticks long.
 */
const LABELS = ["1", "2", "3", "2", "3", "2", "3", "2", "4"];
const timeline = makeTimeline(LABELS);

/** Pass k starts at position 1 + 2 (k - 1). */
const passStart = (pass: number): number => (1 + 2 * (pass - 1)) * POSITION_TICKS;
const P1 = passStart(1);
const P2 = passStart(2);
const P3 = passStart(3);
const P4 = passStart(4);
const ENDING = 8 * POSITION_TICKS;
const PASS_TICKS = 2 * POSITION_TICKS;
const BEAT = POSITION_TICKS / BEATS;

function at(measure: string, beat = 0, occurrence = 1): Location {
  return { measure, beat, occurrence };
}

function vamp(occurrence: number, options: { out?: VampOut; vocals?: VampVocals } = {}): Section {
  return { kind: "vamp", from: at("2", 0, occurrence), to: at("3", BEATS - 1, occurrence), out: options.out ?? "onEnd", vocals: options.vocals ?? "all" };
}

function repeat(occurrence: number, passes: number): Section {
  return { kind: "repeat", from: at("2", 0, occurrence), to: at("3", BEATS - 1, occurrence), passes };
}

function cut(from: number, to = from): Section {
  return { kind: "cut", from: at("2", 0, from), to: at("3", BEATS - 1, to) };
}

/** The incomplete fourth pass. */
const CUT_LAST = { kind: "cut", from: at("2", 0, 4), to: at("2", BEATS - 1, 4) } as const satisfies Section;

function route(sections: Section[], vampsEnabled = true): Route {
  return new Route(timeline, sections, { vampsEnabled });
}

function passStarts(target: Route, index = 0): number[] {
  return target.getSections()[index]!.passes.map(pass => pass.start);
}

describe("A vamp on one pass of a recorded repeat", () => {
  it("takes in the passes from its own up to the incomplete one", () => {
    expect(passStarts(route([vamp(1), CUT_LAST]))).toEqual([P1, P2, P3]);
    expect(passStarts(route([vamp(2), CUT_LAST]))).toEqual([P2, P3]);
    expect(passStarts(route([vamp(3), CUT_LAST]))).toEqual([P3]);
  });

  it("loops the pass before the last on the first pass", () => {
    const held = route([vamp(1), CUT_LAST]);
    expect(followJumps(held, P1, 3)).toEqual([[P3, P2], [P3, P2], [P3, P2]]);
  });

  it("plays the passes before a middle pass as recorded and loops from there", () => {
    const held = route([vamp(2), CUT_LAST]);
    expect(held.stateAt(P1)).toBeUndefined();
    expect(held.stateAt(P2)).toEqual({ section: 0, pass: 1, released: false });
    // A vamp of two recorded passes loops its first pass while it is held.
    expect(followJumps(held, 0, 2)).toEqual([[P3, P2], [P3, P2]]);
  });

  it("loops the last pass on its own and leaves straight to the ending", () => {
    const held = route([vamp(3), CUT_LAST]);
    expect(followJumps(held, 0, 2)).toEqual([[P4, P3], [P4, P3]]);

    const released: RouteState = { section: 0, pass: 2, released: true };
    expect(followJumps(held, P3 + BEAT, 1, released)).toEqual([[P4, ENDING]]);
  });

  it("plays everything as recorded while vamps are disabled", () => {
    expect(route([vamp(2)], false).getSections()).toEqual([]);
    expect(playPositions(timeline, route([vamp(2), CUT_LAST], false))).toEqual([0, 1, 2, 3, 4, 5, 6, 8]);
  });
});

describe("Releasing a vamp on the first pass", () => {
  const released: RouteState = { section: 0, pass: 2, released: true };
  const midpoint = P2 + POSITION_TICKS;

  it.each([
    { out: "onEnd", when: "before the midpoint", tick: P2 + BEAT, jumps: [[midpoint, P3 + POSITION_TICKS], [P4, ENDING]] },
    { out: "onEnd", when: "after the midpoint", tick: midpoint + BEAT, jumps: [[P4, ENDING]] },
    { out: "onEnd", when: "on a barline", tick: P2, jumps: [[P2, P3], [P4, ENDING]] },
    { out: "anyBar", when: "before the midpoint", tick: P2 + BEAT, jumps: [[midpoint, ENDING]] },
    { out: "anyBar", when: "after the midpoint", tick: midpoint + BEAT, jumps: [[P3, ENDING]] },
    { out: "anyBar", when: "on a barline", tick: P2, jumps: [[midpoint, ENDING]] },
    { out: "anyBeat", when: "before the midpoint", tick: P2 + BEAT, jumps: [[P2 + 2 * BEAT, ENDING]] },
    { out: "anyBeat", when: "after the midpoint", tick: midpoint + BEAT, jumps: [[midpoint + 2 * BEAT, ENDING]] },
    { out: "anyBeat", when: "on a barline", tick: P2, jumps: [[P2 + BEAT, ENDING]] },
  ] as const)("with out = $out $when skips the incomplete pass in the same jump", ({ out, tick, jumps }) => {
    const target = route([vamp(1, { out }), CUT_LAST]);
    expect(followJumps(target, tick, 3, released)).toEqual(jumps);
  });
});

describe("A repeat on one pass of a recorded repeat", () => {
  it.each([
    { passes: 1, played: [0, 5, 6, 8] },
    { passes: 2, played: [0, 1, 2, 5, 6, 8] },
    { passes: 3, played: [0, 1, 2, 3, 4, 5, 6, 8] },
    { passes: 5, played: [0, 1, 2, 3, 4, 3, 4, 3, 4, 5, 6, 8] },
  ])("plays $passes passes from the first pass as $played", ({ passes, played }) => {
    expect(playPositions(timeline, route([repeat(1, passes), CUT_LAST]))).toEqual(played);
  });

  it("plays the passes before its own as recorded", () => {
    expect(playPositions(timeline, route([repeat(2, 3), CUT_LAST]))).toEqual([0, 1, 2, 3, 4, 3, 4, 5, 6, 8]);
  });

  it("does not count the incomplete pass with another ending", () => {
    expect(passStarts(route([repeat(1, 3)]))).toEqual([P1, P2, P3]);
    expect(playPositions(timeline, route([repeat(1, 3)]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("stops at a disabled vamp, which plays as recorded", () => {
    const target = route([repeat(1, 2), vamp(3)], false);
    expect(passStarts(target)).toEqual([P1, P2]);
    expect(playPositions(timeline, target)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe("Sections on neighbouring passes", () => {
  it("plays a repeat after the passes of another", () => {
    const target = route([repeat(1, 2), repeat(3, 2), CUT_LAST]);
    expect(passStarts(target, 0)).toEqual([P1, P2]);
    expect(passStarts(target, 1)).toEqual([P3]);
    expect(playPositions(timeline, target)).toEqual([0, 1, 2, 3, 4, 5, 6, 5, 6, 8]);
  });

  it("cuts one pass and plays the others", () => {
    expect(playPositions(timeline, route([cut(2)]))).toEqual([0, 1, 2, 5, 6, 7, 8]);
  });

  it("cuts across several passes and goes past neighbouring cuts in one jump", () => {
    expect(followJumps(route([cut(2, 3), CUT_LAST]), 0, 3)).toEqual([[P2, ENDING]]);
  });

  it("enters a vamp right after a cut on the pass before", () => {
    const target = route([cut(1), vamp(2)]);
    expect(followJumps(target, 0, 2)).toEqual([[P1, P2], [P3, P2]]);
  });
});

describe("Seeking into a pass", () => {
  const target = route([vamp(1), CUT_LAST]);

  it("counts the recorded pass as the desired pass", () => {
    expect(target.stateAt(P2 + BEAT)).toEqual({ section: 0, pass: 2, released: false });
    expect(target.stateAt(P3 + BEAT)).toEqual({ section: 0, pass: 3, released: false });
  });

  it("plays on from inside a cut and jumps from its start", () => {
    expect(target.stateAt(P4 + BEAT)).toBeUndefined();
    expect(target.nextJump(undefined, P4 + BEAT)).toBeUndefined();
    expect(target.nextJump(undefined, P4)).toEqual({ at: P4, to: ENDING, next: undefined });
  });
});

describe("Vocals of a vamp on a middle pass", () => {
  const first: RouteState = { section: 0, pass: 1, released: false };
  const again: RouteState = { section: 0, pass: 2, released: false };
  const leaving: RouteState = { section: 0, pass: 2, released: true };
  const inOwnPass = P2 + BEAT;
  const inLastPass = P3 + BEAT;

  it("enters in its own pass, repeats when it loops back and exits in the last recorded pass", () => {
    const target = route([vamp(2), CUT_LAST]);
    expect(target.getVocalRole(first, inOwnPass)).toBe("entering");
    expect(target.getVocalRole(again, inOwnPass)).toBe("repeating");
    expect(target.getVocalRole(leaving, inLastPass)).toBe("exiting");
  });

  it.each([
    { vocals: "all", muted: [false, false, false] },
    { vocals: "first", muted: [false, true, true] },
    { vocals: "last", muted: [true, true, false] },
    { vocals: "split", muted: [false, true, false] },
  ] as const)("mutes $vocals as $muted", ({ vocals, muted }) => {
    const target = route([vamp(2, { vocals }), CUT_LAST]);
    expect([
      target.muteVocals(first, inOwnPass),
      target.muteVocals(again, inOwnPass),
      target.muteVocals(leaving, inLastPass),
    ]).toEqual(muted);
  });

  it("splits a single recorded pass at its midpoint", () => {
    const target = route([vamp(3, { vocals: "split" }), CUT_LAST]);
    const state: RouteState = { section: 0, pass: 1, released: true };
    expect(target.getVocalRole(state, P3 + BEAT)).toBe("entering");
    expect(target.getVocalRole(state, P3 + PASS_TICKS - BEAT)).toBe("exiting");
  });
});
