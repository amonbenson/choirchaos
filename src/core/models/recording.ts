import type Measure from "./measure";
import type { MeasureId } from "./measure";

/** Inclusive range of measures in score order that the recording plays back to back. */
export type RecordingSpan = { from: MeasureId; to: MeasureId };

/** Anchors the occurrence of a measure to a time in the audio recording, in seconds. */
export type StoredWarpMarker = { measure: MeasureId; occurrence: number; time: number };

export type StoredRecording = {
  spans: RecordingSpan[];
  warpMarkers: StoredWarpMarker[];
};

/** A beat at the `occurrence`-th time its measure plays. Beats are 0-based, occurrences 1-based. */
export type Location = { measure: MeasureId; beat: number; occurrence: number };

export type StoredLocation = { measure: MeasureId; beat: number; occurrence?: number };

/** One measure as the recording plays it. `position` is its index in the expanded recording. */
export type TimelineEntry = { position: number; measure: MeasureId; occurrence: number };

export type Timeline = readonly TimelineEntry[];

export type Occurrence = Pick<Location, "measure" | "occurrence">;

/** Positions of one back-to-back repetition of a section's range in the recording, both inclusive. */
export type RecordedPass = { first: number; last: number };

const FIRST_OCCURRENCE = 1;

export function serializeLocation({ measure, beat, occurrence }: Location): StoredLocation {
  return occurrence === FIRST_OCCURRENCE ? { measure, beat } : { measure, beat, occurrence };
}

export function deserializeLocation({ measure, beat, occurrence }: StoredLocation): Location {
  return { measure, beat, occurrence: occurrence ?? FIRST_OCCURRENCE };
}

export function isSameLocation(a: Location, b: Location): boolean {
  return a.measure === b.measure && a.beat === b.beat && a.occurrence === b.occurrence;
}

function getScoreIndices(measures: readonly Measure[]): Map<MeasureId, number> {
  return new Map(measures.map((measure, index) => [measure.id, index]));
}

export function expandRecording(measures: readonly Measure[], spans: readonly RecordingSpan[]): TimelineEntry[] {
  const indices = getScoreIndices(measures);
  const occurrences = new Map<MeasureId, number>();
  const timeline: TimelineEntry[] = [];

  for (const { from, to } of spans) {
    const first = indices.get(from);
    const last = indices.get(to);
    if (first === undefined || last === undefined || first > last) {
      throw new RangeError(`Recording span ${from}..${to} does not cover measures in score order.`);
    }

    for (let index = first; index <= last; index++) {
      const measure = measures[index]!.id;
      const occurrence = (occurrences.get(measure) ?? 0) + 1;
      occurrences.set(measure, occurrence);
      timeline.push({ position: timeline.length, measure, occurrence });
    }
  }

  return timeline;
}

export function findPosition(timeline: Timeline, { measure, occurrence }: Occurrence): number | undefined {
  return timeline.find(entry => entry.measure === measure && entry.occurrence === occurrence)?.position;
}

export function countOccurrences(timeline: Timeline, measure: MeasureId): number {
  return timeline.filter(entry => entry.measure === measure).length;
}

/** Orders locations as the recording plays them. Locations that do not resolve go last. */
export function compareLocations(timeline: Timeline, a: Location, b: Location): number {
  const positionA = findPosition(timeline, a) ?? Infinity;
  const positionB = findPosition(timeline, b) ?? Infinity;
  if (positionA !== positionB) {
    return positionA < positionB ? -1 : 1;
  }

  return a.beat - b.beat;
}

/** Why a location does not point at a beat of the recording, or undefined when it does. */
export function validateLocation(measures: readonly Measure[], timeline: Timeline, location: Location): string | undefined {
  const measure = measures.find(candidate => candidate.id === location.measure);
  if (!measure) {
    return `Measure ${location.measure} does not exist.`;
  }

  if (!Number.isInteger(location.beat) || location.beat < 0 || location.beat >= measure.beats) {
    return `Measure ${measure.label} has no beat ${location.beat + 1}.`;
  }

  if (!Number.isInteger(location.occurrence) || findPosition(timeline, location) === undefined) {
    return `Measure ${measure.label} is not played ${location.occurrence} times.`;
  }

  return undefined;
}

function isRepetition(timeline: Timeline, pass: readonly MeasureId[], start: number): boolean {
  return pass.every((measure, offset) => timeline[start + offset]?.measure === measure);
}

/**
 * The first pass runs from the section's `from` to its `to`. Every directly following run of the same
 * measures is another recorded pass. Endings that differ are not repetitions.
 */
export function findRecordedPasses(timeline: Timeline, section: { from: Location; to: Location }): RecordedPass[] {
  const first = findPosition(timeline, section.from);
  const last = findPosition(timeline, section.to);
  if (first === undefined || last === undefined || last < first) {
    return [];
  }

  const pass = timeline.slice(first, last + 1).map(entry => entry.measure);
  const passes: RecordedPass[] = [{ first, last }];

  for (let start = last + 1; isRepetition(timeline, pass, start); start += pass.length) {
    passes.push({ first: start, last: start + pass.length - 1 });
  }

  return passes;
}

function isInsideSpan(score: readonly MeasureId[], span: RecordingSpan, index: number): boolean {
  return score.indexOf(span.from) < index && index < score.indexOf(span.to);
}

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i]!)) {
      return i;
    }
  }

  return -1;
}

/**
 * Lets the recording play a measure that was just inserted into the score. A measure inside a span
 * already plays. One right after a span end extends the last span that ends there, and one at the
 * start of the score extends the first span starting right after it.
 */
export function addMeasureToSpans(spans: readonly RecordingSpan[], score: readonly MeasureId[], measure: MeasureId): RecordingSpan[] {
  if (spans.length === 0) {
    return [{ from: measure, to: measure }];
  }

  const index = score.indexOf(measure);
  if (spans.some(span => isInsideSpan(score, span, index))) {
    return [...spans];
  }

  const previous = score[index - 1];
  const next = score[index + 1];
  const result = spans.map(span => ({ ...span }));

  if (previous !== undefined) {
    const extended = findLastIndex(result, span => span.to === previous);
    if (extended !== -1) {
      result[extended]!.to = measure;
    }
  } else if (next !== undefined) {
    const extended = result.find(span => span.from === next);
    if (extended) {
      extended.from = measure;
    }
  }

  return result;
}

/** Takes a measure out of the recording before it leaves the score. Span ends move inward, empty spans disappear. */
export function removeMeasureFromSpans(spans: readonly RecordingSpan[], score: readonly MeasureId[], measure: MeasureId): RecordingSpan[] {
  const index = score.indexOf(measure);

  return spans
    .filter(span => span.from !== measure || span.to !== measure)
    .map(span => ({
      from: span.from === measure ? score[index + 1]! : span.from,
      to: span.to === measure ? score[index - 1]! : span.to,
    }));
}
