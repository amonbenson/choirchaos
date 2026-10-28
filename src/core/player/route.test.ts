import { describe, expect, it } from "vitest";

import type { VampVocals } from "@/core/models/sections";
import { BEAT_TICKS, cut, makeTimeline, playPositions, POSITION_TICKS, repeat, vamp } from "@/test/route";

import Route, { type RouteState, type VocalRole } from "./route";
import { findPositionAt } from "./timeline";

// Measure "2" recorded four times back to back (B = 4), at positions 1 to 4.
const BAKED = ["1", "2", "2", "2", "2", "3"];

describe("Route pass mapping", () => {
  const timeline = makeTimeline(BAKED);

  it.each([
    { passes: 1, played: [0, 4, 5] },
    { passes: 2, played: [0, 1, 4, 5] },
    { passes: 3, played: [0, 1, 2, 4, 5] },
    { passes: 4, played: [0, 1, 2, 3, 4, 5] },
    { passes: 6, played: [0, 1, 2, 3, 3, 3, 4, 5] },
  ])("plays $passes passes of 4 recorded ones as $played", ({ passes, played }) => {
    const route = new Route(timeline, [repeat("2", "2", passes)], { vampsEnabled: true });
    expect(playPositions(timeline, route)).toEqual(played);
  });

  it("loops an unreleased vamp through its recorded passes and then repeats the one before the last", () => {
    const route = new Route(timeline, [vamp("2", "2")], { vampsEnabled: true });
    expect(route.nextJump({ section: 0, pass: 1, released: false }, 450))
      .toEqual({ at: 800, to: 800, next: { section: 0, pass: 2, released: false } });
    expect(route.nextJump({ section: 0, pass: 3, released: false }, 1250))
      .toEqual({ at: 1600, to: 1200, next: { section: 0, pass: 4, released: false } });
    expect(route.nextJump({ section: 0, pass: 4, released: false }, 1250))
      .toEqual({ at: 1600, to: 1200, next: { section: 0, pass: 5, released: false } });
  });

  it("loops a single recorded pass", () => {
    const plain = makeTimeline(["1", "2", "3"]);
    const route = new Route(plain, [repeat("2", "2", 3)], { vampsEnabled: true });
    expect(playPositions(plain, route)).toEqual([0, 1, 1, 1, 2]);
  });

  it("plays disabled vamps as recorded", () => {
    const route = new Route(timeline, [vamp("2", "2")], { vampsEnabled: false });
    expect(route.getSections()).toHaveLength(0);
    expect(playPositions(timeline, route)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("plays sections over several measures and keeps other measures untouched", () => {
    const multi = makeTimeline(["1", "2", "3", "2", "3", "2", "3", "4"]);
    const route = new Route(multi, [repeat("2", "3", 2)], { vampsEnabled: true });
    expect(playPositions(multi, route)).toEqual([0, 1, 2, 5, 6, 7]);
  });

  it("does not count a pass with a different ending as a recorded pass", () => {
    // First and second ending: 1 2 3a, 1 2 3b. The second time through is no repetition of the first.
    const endings = makeTimeline(["1", "2", "3a", "1", "2", "3b"]);
    const asRecorded = new Route(endings, [repeat("1", "3a", 1)], { vampsEnabled: true });
    expect(asRecorded.getSections()[0]!.passes).toHaveLength(1);
    expect(playPositions(endings, asRecorded)).toEqual([0, 1, 2, 3, 4, 5]);

    const twice = new Route(endings, [repeat("1", "3a", 2)], { vampsEnabled: true });
    expect(playPositions(endings, twice)).toEqual([0, 1, 2, 0, 1, 2, 3, 4, 5]);
  });
});

describe("Route state", () => {
  const timeline = makeTimeline(BAKED);

  it("derives the pass from the recorded pass at a position", () => {
    const route = new Route(timeline, [repeat("2", "2", 6)], { vampsEnabled: true });
    expect(route.stateAt(0)).toBeUndefined();
    expect(route.stateAt(2 * POSITION_TICKS)).toEqual({ section: 0, pass: 2, released: false });
    expect(route.stateAt(4 * POSITION_TICKS)).toEqual({ section: 0, pass: 6, released: false });
    expect(route.stateAt(5 * POSITION_TICKS)).toBeUndefined();
  });

  it("clamps passes beyond the total so the last pass follows", () => {
    const route = new Route(timeline, [repeat("2", "2", 2)], { vampsEnabled: true });
    expect(route.stateAt(3 * POSITION_TICKS)).toEqual({ section: 0, pass: 2, released: false });
  });

  it("counts a vamp's pass as the recorded pass at a position", () => {
    const route = new Route(timeline, [vamp("2", "2")], { vampsEnabled: true });
    expect(route.stateAt(4 * POSITION_TICKS)).toEqual({ section: 0, pass: 4, released: false });
  });

  it("reports the section state for the UI", () => {
    const route = new Route(timeline, [vamp("2", "2")], { vampsEnabled: true });
    expect(route.getSectionState({ section: 0, pass: 3, released: false }))
      .toEqual({ section: 0, kind: "vamp", pass: 3, passes: undefined, recordedPasses: 4, released: false });
    expect(route.getSectionState({ section: 0, pass: 3, released: true }))
      .toEqual({ section: 0, kind: "vamp", pass: 3, passes: 3, recordedPasses: 4, released: true });
  });

  it("reports a cut only at ticks inside it", () => {
    const route = new Route(timeline, [cut("1", "1")], { vampsEnabled: true });
    expect(route.getCutStateAt(1))
      .toEqual({ section: 0, kind: "cut", pass: 1, passes: 0, recordedPasses: 1, released: false });
    expect(route.getCutStateAt(POSITION_TICKS)).toBeUndefined();
  });

  it("keeps section indices of the song when vamps are disabled", () => {
    const route = new Route(timeline, [vamp("1", "1"), repeat("2", "2", 2)], { vampsEnabled: false });
    expect(route.stateAt(POSITION_TICKS)).toEqual({ section: 1, pass: 1, released: false });
  });
});

describe("Route mid-pass last pass", () => {
  // Measures "2" and "3" recorded three times: P1 = positions 1-2, P2 = 3-4, P3 = 5-6.
  const timeline = makeTimeline(["1", "2", "3", "2", "3", "2", "3", "4"]);
  const route = new Route(timeline, [vamp("2", "3")], { vampsEnabled: true });
  const released: RouteState = { section: 0, pass: 1, released: true };

  it("jumps at the next barline up to the midpoint to the same place in the last pass", () => {
    expect(route.nextJump(released, 500)).toEqual({ at: 800, to: 2400, next: released });
  });

  it("jumps at once when the release happens on a barline", () => {
    expect(route.nextJump(released, 400)).toEqual({ at: 400, to: 2000, next: released });
  });

  it("jumps at the next beat when no barline is left in the pass, so no further pass plays", () => {
    expect(route.nextJump(released, 900)).toEqual({ at: 1000, to: 2600, next: released });
  });

  it("leaves at the end of the pass when the release comes in its last beat", () => {
    expect(route.nextJump(released, 1150)).toEqual({ at: 1200, to: 2800, next: undefined });
  });

  it("leaves the section after the last recorded pass", () => {
    expect(route.nextJump({ section: 0, pass: 2, released: true }, 2100)).toEqual({ at: 2800, to: 2800, next: undefined });
  });

  it("jumps to the last pass at the first barline when one pass of several is wanted", () => {
    const once = new Route(timeline, [repeat("2", "3", 1)], { vampsEnabled: true });
    expect(playPositions(timeline, once)).toEqual([0, 5, 6, 7]);
  });

  it("maps a tick to the same beat and beat fraction in a differently warped pass", () => {
    // The third pass plays at half speed: positions 5 and 6 are 800 ticks long.
    const warped = makeTimeline(["1", "2", "3", "2", "3", "2", "3", "4"], [400, 400, 400, 400, 400, 800, 800, 400]);
    const warpedRoute = new Route(warped, [vamp("2", "3")], { vampsEnabled: true });
    const [first, , last] = warpedRoute.getSections()[0]!.passes;

    // Position 2, beat 1, a quarter into the beat.
    const tick = 800 + BEAT_TICKS + BEAT_TICKS / 4;
    const mapped = warpedRoute.mapTick(tick, first!, last!);
    expect(findPositionAt(warped, mapped)!.position).toBe(6);
    expect(mapped).toBe(2800 + 200 + 50);
  });
});

describe("Route early exits", () => {
  const timeline = makeTimeline(["1", "2", "3", "4"]);

  it.each([
    { out: "onEnd" as const, jump: { at: 1200, to: 1200, next: undefined } },
    { out: "anyBar" as const, jump: { at: 800, to: 1200, next: undefined } },
    { out: "anyBeat" as const, jump: { at: 500, to: 1200, next: undefined } },
  ])("leaves a released vamp with out = $out", ({ out, jump }) => {
    const route = new Route(timeline, [vamp("2", "3", { out })], { vampsEnabled: true });
    expect(route.nextJump({ section: 0, pass: 4, released: true }, 450)).toEqual(jump);
  });

  it("keeps looping an unreleased vamp", () => {
    const route = new Route(timeline, [vamp("2", "3", { out: "anyBeat" })], { vampsEnabled: true });
    expect(route.nextJump({ section: 0, pass: 4, released: false }, 450))
      .toEqual({ at: 1200, to: 400, next: { section: 0, pass: 5, released: false } });
  });

  it("leaves from an earlier recorded pass straight to the end of the last one", () => {
    const baked = makeTimeline(["1", "2", "3", "2", "3", "2", "3", "4"]);
    const route = new Route(baked, [vamp("2", "3", { out: "anyBar" })], { vampsEnabled: true });
    expect(route.nextJump({ section: 0, pass: 1, released: true }, 450)).toEqual({ at: 800, to: 2800, next: undefined });
  });
});

describe("Route cuts", () => {
  it("skips a cut at tick 0", () => {
    const timeline = makeTimeline(["1", "2", "3"]);
    const route = new Route(timeline, [cut("1", "1")], { vampsEnabled: true });
    expect(route.nextJump(route.stateAt(0), 0)).toEqual({ at: 0, to: 400, next: undefined });
    expect(playPositions(timeline, route)).toEqual([1, 2]);
  });

  it("skips back-to-back cuts", () => {
    const timeline = makeTimeline(["1", "2", "3", "4"]);
    const route = new Route(timeline, [cut("1", "1"), cut("2", "3")], { vampsEnabled: true });
    expect(playPositions(timeline, route)).toEqual([3]);
  });

  it("skips only its own pass of a recorded repeat", () => {
    const timeline = makeTimeline(BAKED);
    const route = new Route(timeline, [cut("2", "2")], { vampsEnabled: true });
    expect(playPositions(timeline, route)).toEqual([0, 2, 3, 4, 5]);
  });

  it("plays from a seek strictly inside a cut", () => {
    const timeline = makeTimeline(["1", "2", "3", "4"]);
    const route = new Route(timeline, [cut("2", "3")], { vampsEnabled: true });
    expect(playPositions(timeline, route, 900)).toEqual([2, 3]);
    expect(playPositions(timeline, route, 400)).toEqual([3]);
  });

  it("enters a section that starts where a cut ends", () => {
    const timeline = makeTimeline(["1", "2", "3"]);
    const route = new Route(timeline, [cut("1", "1"), repeat("2", "2", 2)], { vampsEnabled: true });
    expect(playPositions(timeline, route)).toEqual([1, 1, 2]);
  });
});

describe("Route vocals", () => {
  type VocalCase = { state: RouteState; tick: number; role: VocalRole };

  const baked = makeTimeline(BAKED);
  const bakedRoute = (vocals: VampVocals = "all"): Route => new Route(baked, [vamp("2", "2", { vocals })], { vampsEnabled: true });

  it.each<VocalCase>([
    { state: { section: 0, pass: 1, released: false }, tick: 450, role: "entering" },
    { state: { section: 0, pass: 2, released: false }, tick: 850, role: "repeating" },
    { state: { section: 0, pass: 3, released: false }, tick: 1250, role: "repeating" },
    { state: { section: 0, pass: 5, released: false }, tick: 1250, role: "repeating" },
    { state: { section: 0, pass: 4, released: false }, tick: 1650, role: "repeating" },
    { state: { section: 0, pass: 2, released: true }, tick: 1650, role: "exiting" },
    { state: { section: 0, pass: 4, released: true }, tick: 1650, role: "exiting" },
  ])("treats pass $state.pass at tick $tick, released: $state.released, as $role", ({ state, tick, role }) => {
    expect(bakedRoute().getVocalRole(state, tick)).toBe(role);
  });

  const plain = makeTimeline(["1", "2", "3"]);
  const plainRoute = new Route(plain, [vamp("2", "2")], { vampsEnabled: true });

  it.each<VocalCase>([
    { state: { section: 0, pass: 1, released: false }, tick: 500, role: "entering" },
    { state: { section: 0, pass: 1, released: false }, tick: 700, role: "repeating" },
    { state: { section: 0, pass: 2, released: false }, tick: 500, role: "repeating" },
    { state: { section: 0, pass: 2, released: false }, tick: 700, role: "repeating" },
    { state: { section: 0, pass: 2, released: true }, tick: 700, role: "exiting" },
    { state: { section: 0, pass: 1, released: true }, tick: 700, role: "exiting" },
  ])("splits a single recorded pass at its midpoint: pass $state.pass at $tick is $role", ({ state, tick, role }) => {
    expect(plainRoute.getVocalRole(state, tick)).toBe(role);
  });

  it.each([
    { vocals: "all" as const, muted: { entering: false, repeating: false, exiting: false } },
    { vocals: "first" as const, muted: { entering: false, repeating: true, exiting: true } },
    { vocals: "last" as const, muted: { entering: true, repeating: true, exiting: false } },
    { vocals: "split" as const, muted: { entering: false, repeating: true, exiting: false } },
  ])("mutes vocals per the $vocals mode", ({ vocals, muted }) => {
    const route = bakedRoute(vocals);
    expect(route.muteVocals({ section: 0, pass: 1, released: false }, 450)).toBe(muted.entering);
    expect(route.muteVocals({ section: 0, pass: 2, released: false }, 850)).toBe(muted.repeating);
    expect(route.muteVocals({ section: 0, pass: 4, released: true }, 1650)).toBe(muted.exiting);
  });

  it("never mutes in repeats", () => {
    const route = new Route(baked, [repeat("2", "2", 4)], { vampsEnabled: true });
    expect(route.muteVocals({ section: 0, pass: 2, released: false }, 850)).toBe(false);
  });
});
