import type Route from "@/core/player/route";
import type { TimelinePosition } from "@/core/player/timeline";

export const BEATS = 4;
export const POSITION_TICKS = 400;
export const BEAT_TICKS = POSITION_TICKS / BEATS;

/** One position per label with 4 beats, 400 ticks long unless `lengths` says otherwise. */
export function makeTimeline(labels: string[], lengths: number[] = []): TimelinePosition[] {
  const occurrences = new Map<string, number>();
  let tick = 0;
  return labels.map((measure, position) => {
    const occurrence = (occurrences.get(measure) ?? 0) + 1;
    occurrences.set(measure, occurrence);
    const length = lengths[position] ?? POSITION_TICKS;
    const start = tick;
    tick += length;
    return {
      position,
      measure,
      occurrence,
      beats: BEATS,
      beatTicks: Array.from({ length: BEATS }, (_, beat) => start + beat * length / BEATS),
      endTick: tick,
    };
  });
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
