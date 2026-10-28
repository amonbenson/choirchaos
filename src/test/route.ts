import type { Location, Timeline } from "@/core/models/recording";
import type { Section, VampOut, VampVocals } from "@/core/models/sections";
import type Route from "@/core/player/route";
import type { TimelinePosition } from "@/core/player/timeline";

export const BEATS = 4;
export const POSITION_TICKS = 400;
export const BEAT_TICKS = POSITION_TICKS / BEATS;

/** One timeline entry per label, which is also the measure ID, counting each measure's occurrences. */
export function toTimeline(labels: readonly string[]): Timeline {
  const occurrences = new Map<string, number>();
  return labels.map((measure, position) => {
    const occurrence = (occurrences.get(measure) ?? 0) + 1;
    occurrences.set(measure, occurrence);
    return { position, measure, occurrence };
  });
}

/** One position per label with 4 beats, 400 ticks long unless `lengths` says otherwise. */
export function makeTimeline(labels: readonly string[], lengths: readonly number[] = []): TimelinePosition[] {
  let tick = 0;
  return toTimeline(labels).map((entry) => {
    const length = lengths[entry.position] ?? POSITION_TICKS;
    const start = tick;
    tick += length;
    return {
      ...entry,
      beats: BEATS,
      beatTicks: Array.from({ length: BEATS }, (_, beat) => start + beat * length / BEATS),
      endTick: tick,
    };
  });
}

export function at(measure: string, beat = 0, occurrence = 1): Location {
  return { measure, beat, occurrence };
}

type VampOptions = { occurrence?: number; out?: VampOut; vocals?: VampVocals };

/** Sections over whole 4-beat measures, from the first beat of `from` to the last beat of `to` in one pass. */
export function vamp(from: string, to: string, { occurrence = 1, out = "onEnd", vocals = "all" }: VampOptions = {}): Section {
  return { kind: "vamp", from: at(from, 0, occurrence), to: at(to, BEATS - 1, occurrence), out, vocals };
}

export function repeat(from: string, to: string, passes: number, occurrence = 1): Section {
  return { kind: "repeat", from: at(from, 0, occurrence), to: at(to, BEATS - 1, occurrence), passes };
}

/** A cut from `from` in pass `occurrence` to `to` in pass `toOccurrence`, so it may span several passes. */
export function cut(from: string, to: string, occurrence = 1, toOccurrence = occurrence): Section {
  return { kind: "cut", from: at(from, 0, occurrence), to: at(to, BEATS - 1, toOccurrence) };
}

/** Plays the route from `start` to the end and lists the positions in the order they sound. */
export function playPositions(timeline: TimelinePosition[], route: Route, start = 0): number[] {
  const end = timeline.at(-1)!.endTick;
  const played: number[] = [];
  const playRange = (from: number, to: number): void => {
    for (const position of timeline) {
      const overlaps = position.beatTicks[0]! < to && position.endTick > from;
      if (overlaps && played.at(-1) !== position.position) {
        played.push(position.position);
      }
    }
  };

  let state = route.stateAt(start);
  let tick = start;
  for (let i = 0; i < 100; i++) {
    const jump = route.nextJump(state, tick);
    if (!jump) {
      break;
    }

    playRange(tick, jump.at);
    if (jump.to !== jump.at) {
      // A jump to the same position starts it again.
      played.push(-1);
    }

    tick = jump.to;
    state = jump.next;
  }

  playRange(tick, end);
  return played.filter(p => p !== -1);
}

/** Follows the route from `tick` and lists every real jump as `[at, to]`, at most `count`. */
export function followJumps(route: Route, tick: number, count: number, state = route.stateAt(tick)): [number, number][] {
  const jumps: [number, number][] = [];
  for (let i = 0; i < 50 && jumps.length < count; i++) {
    const jump = route.nextJump(state, tick);
    if (!jump) {
      break;
    }

    if (jump.to !== jump.at) {
      jumps.push([jump.at, jump.to]);
    }

    tick = jump.to;
    state = jump.next;
  }

  return jumps;
}
