import { readBeatMapBars } from "../midi/beatMap";
import { BeatEvent, MidiEventList, TempoEvent } from "../midi/events";
import type { MTIMidiJson } from "../midi/mtiJson";
import type { Tick } from "../midi/types";
import type { WarpMarker } from "../midi/warp";
import type WarpMap from "../midi/warp";
import type Measure from "../models/measure";
import { findPosition, type Occurrence, type Timeline, type TimelineEntry } from "../models/recording";
import { getPositionedSyncPoints, type SyncPoints } from "../models/warpEditing";
import type { PlayerLocation } from "./types";

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** A timeline position with its timing. `beatTicks` holds the start of every beat, `endTick` where the next position starts. */
export type TimelinePosition = TimelineEntry & {
  beats: number;
  beatTicks: readonly Tick[];
  endTick: Tick;
};

export type ResolvedTimeline = readonly TimelinePosition[];

/**
 * Times a MIDI song's timeline with its beat map, whose k-th bar is timeline position k. Each position
 * takes its beats from its own bar, which can have more beats than the measure's first occurrence.
 */
export function resolveMidiTimeline(timeline: Timeline, beatMap: MTIMidiJson): TimelinePosition[] {
  const bars = readBeatMapBars(beatMap);
  if (bars.length !== timeline.length) {
    throw new Error(`The beat map has ${bars.length} measures, but the recording plays ${timeline.length}.`);
  }

  return timeline.map((entry, position) => {
    const { beats, beatTicks, endTick } = bars[position]!;
    return { ...entry, beats, beatTicks, endTick };
  });
}

/** The beat each timeline position starts on, counted from the start of the timeline, followed by the total. */
function getFirstBeats(beats: readonly number[]): number[] {
  let total = 0;
  return [0, ...beats.map(count => total += count)];
}

/**
 * Resolves sync points to the beats they anchor, the end sync point to the beat after the last.
 * Markers whose occurrence the recording no longer plays are dropped.
 */
function resolveWarpMarkers(timeline: Timeline, sync: SyncPoints, firstBeats: readonly number[]): WarpMarker[] {
  return getPositionedSyncPoints(timeline, sync).map(({ position, time }) => ({ beat: firstBeats[position]!, time }));
}

/**
 * Times an audio song's timeline in milliseconds of the recording. Between two sync points every beat lasts
 * equally long, so a measure takes time in proportion to its beats; beyond them beats go on at the nearest rate.
 */
export function resolveAudioTimeline(timeline: Timeline, measures: readonly Measure[], sync: SyncPoints, warpMap: WarpMap): TimelinePosition[] {
  const beatsById = new Map(measures.map(measure => [measure.id, measure.beats]));
  const beatCounts = timeline.map(entry => beatsById.get(entry.measure) ?? 1);
  const firstBeats = getFirstBeats(beatCounts);
  warpMap.setMarkers(resolveWarpMarkers(timeline, sync, firstBeats));

  return timeline.map((entry, position) => {
    const beats = beatCounts[position]!;
    const toTick = (beat: number): Tick => warpMap.beatToTime(firstBeats[position]! + beat) * MILLISECONDS_PER_SECOND;
    return { ...entry, beats, beatTicks: Array.from({ length: beats }, (_, beat) => toTick(beat)), endTick: toTick(beats) };
  });
}

/** The tempo of an audio song: every sync point starts the rate of the beats up to the next. Only changes of tempo get an event. */
export function buildAudioTempoEvents(warpMap: WarpMap): MidiEventList<TempoEvent> {
  const events = new MidiEventList<TempoEvent>();
  let previous: number | undefined;

  for (const beat of [0, ...warpMap.getMarkers().map(marker => marker.beat)]) {
    const bpm = SECONDS_PER_MINUTE / warpMap.getSecondsPerBeat(beat);
    if (bpm !== previous) {
      events.insert(new TempoEvent(warpMap.beatToTime(beat) * MILLISECONDS_PER_SECOND, bpm));
      previous = bpm;
    }
  }

  return events;
}

export function getStartTick(position: TimelinePosition): Tick {
  return position.beatTicks[0]!;
}

/** The start of a 0-based beat. The beat after the last one starts at `endTick`. */
export function getBeatTick(position: TimelinePosition, beat: number): Tick {
  return beat < position.beats ? position.beatTicks[beat]! : position.endTick;
}

/** The position playing at `tick`. Ticks before the first or after the last position clamp to it. */
export function findPositionAt(timeline: ResolvedTimeline, tick: Tick): TimelinePosition | undefined {
  let lo = 0;
  let hi = timeline.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (getStartTick(timeline[mid]!) <= tick) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }

  return timeline[lo];
}

/** The 0-based beat of `position` playing at `tick`. */
export function findBeatAt(position: TimelinePosition, tick: Tick): number {
  let beat = 0;
  while (beat + 1 < position.beats && position.beatTicks[beat + 1]! <= tick) {
    beat++;
  }

  return beat;
}

export function findLocationAt(timeline: ResolvedTimeline, tick: Tick): PlayerLocation | undefined {
  const position = findPositionAt(timeline, tick);
  if (!position) {
    return undefined;
  }

  return { position: position.position, measure: position.measure, occurrence: position.occurrence, beat: findBeatAt(position, tick) };
}

/** The tick of a beat at a timeline position. Beats past the position's bar clamp to its last beat. */
export function getPositionTick(timeline: ResolvedTimeline, position: number, beat = 0): Tick | undefined {
  const entry = timeline[position];
  if (!entry) {
    return undefined;
  }

  return entry.beatTicks[Math.max(0, Math.min(beat, entry.beats - 1))];
}

/** The tick of a beat at a measure occurrence, or undefined when the recording does not play it. */
export function getLocationTick(timeline: ResolvedTimeline, location: Occurrence & { beat: number }): Tick | undefined {
  const position = findPosition(timeline, location);
  return position === undefined ? undefined : getPositionTick(timeline, position, location.beat);
}

export function isSamePlayerLocation(a: PlayerLocation | undefined, b: PlayerLocation | undefined): boolean {
  return a?.position === b?.position && a?.beat === b?.beat && a?.measure === b?.measure && a?.occurrence === b?.occurrence;
}

export function buildBeatEvents(timeline: ResolvedTimeline): MidiEventList<BeatEvent> {
  return new MidiEventList(timeline.flatMap(position =>
    position.beatTicks.map((tick, beat) => new BeatEvent(tick, position.position, beat)),
  ));
}
