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

function getScoreIndices(score: readonly MeasureId[]): Map<MeasureId, number> {
  return new Map(score.map((id, index) => [id, index]));
}

export function expandRecording(measures: readonly Measure[], spans: readonly RecordingSpan[]): TimelineEntry[] {
  const indices = getScoreIndices(getIds(measures));
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

/** A stretch of the recording from one measure occurrence to another, both inclusive. */
export type OccurrenceRange = { from: Occurrence; to: Occurrence };

/**
 * The first pass runs from the section's `from` to its `to`. Every directly following run of the same
 * measures is another recorded pass. Endings that differ are not repetitions.
 */
export function findRecordedPasses(timeline: Timeline, section: OccurrenceRange): RecordedPass[] {
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

/** Like `findRecordedPasses`, but also counts the passes before the range, so any pass of a repeat finds all of them. */
export function findBackToBackPasses(timeline: Timeline, range: OccurrenceRange): RecordedPass[] {
  const passes = findRecordedPasses(timeline, range);
  const selected = passes[0];
  if (!selected) {
    return [];
  }

  const pass = timeline.slice(selected.first, selected.last + 1).map(entry => entry.measure);
  for (let start = selected.first - pass.length; start >= 0 && isRepetition(timeline, pass, start); start -= pass.length) {
    passes.unshift({ first: start, last: start + pass.length - 1 });
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

function getIds(measures: readonly Measure[]): MeasureId[] {
  return measures.map(measure => measure.id);
}

function getSequence(timeline: Timeline): MeasureId[] {
  return timeline.map(entry => entry.measure);
}

/**
 * Compresses the measures the recording plays into spans that move forward by one in score order. A span
 * that jumped back ends where the span before it ended, so a written repeat reads as "1-12, 9-12, 13-40"
 * instead of "1-12, 9-40".
 */
export function spansFromSequence(score: readonly MeasureId[], sequence: readonly MeasureId[]): RecordingSpan[] {
  const indices = getScoreIndices(score);
  const spans: RecordingSpan[] = [];

  for (const measure of sequence) {
    const index = indices.get(measure);
    if (index === undefined) {
      throw new RangeError(`Measure ${measure} is not in the score.`);
    }

    const current = spans.at(-1);
    const previous = spans.at(-2);
    const continues = current !== undefined && indices.get(current.to)! + 1 === index && current.to !== previous?.to;
    if (continues) {
      current.to = measure;
    } else {
      spans.push({ from: measure, to: measure });
    }
  }

  return spans;
}

function normalizeSpans(measures: readonly Measure[], spans: readonly RecordingSpan[]): RecordingSpan[] {
  return spansFromSequence(getIds(measures), getSequence(expandRecording(measures, spans)));
}

export const MAX_RECORDED_COUNT = 100;

function isRecordedCount(count: number): boolean {
  return Number.isInteger(count) && count >= 1 && count <= MAX_RECORDED_COUNT;
}

/**
 * Makes the recording play `range` `count` times back to back, by adding passes after the last one or
 * removing passes from the end. `range` may be any one of the passes.
 */
export function setRecordedCount(measures: readonly Measure[], spans: readonly RecordingSpan[], range: OccurrenceRange, count: number): RecordingSpan[] {
  if (!isRecordedCount(count)) {
    throw new RangeError(`A passage is recorded 1 to ${MAX_RECORDED_COUNT} times.`);
  }

  const timeline = expandRecording(measures, spans);
  const passes = findBackToBackPasses(timeline, range);
  const first = passes[0];
  const last = passes.at(-1);
  if (!first || !last) {
    throw new RangeError("The recording does not play these measures in this order.");
  }

  const sequence = getSequence(timeline);
  const pass = sequence.slice(first.first, first.last + 1);
  const repeated = Array.from({ length: count }, () => pass).flat();
  return spansFromSequence(getIds(measures), [...sequence.slice(0, first.first), ...repeated, ...sequence.slice(last.last + 1)]);
}

function getSpanLength(indices: ReadonlyMap<MeasureId, number>, span: RecordingSpan): number {
  return indices.get(span.to)! - indices.get(span.from)! + 1;
}

/** Splits the spans into those played up to and including `position` and those played after it. */
function splitSpansAfter(score: readonly MeasureId[], spans: readonly RecordingSpan[], position: number): [RecordingSpan[], RecordingSpan[]] {
  const indices = getScoreIndices(score);
  const head: RecordingSpan[] = [];
  const rest: RecordingSpan[] = [];
  let start = 0;

  for (const span of spans) {
    const end = start + getSpanLength(indices, span) - 1;
    if (end <= position) {
      head.push(span);
    } else if (start > position) {
      rest.push(span);
    } else {
      const split = indices.get(span.from)! + position - start;
      head.push({ from: span.from, to: score[split]! });
      rest.push({ from: score[split + 1]!, to: span.to });
    }

    start = end + 1;
  }

  return [head, rest];
}

/**
 * Makes the recording continue at measure `to` after the occurrence `after`. When a later part of the
 * recording plays `to`, the recording skips ahead to it. Otherwise it jumps there and plays on to the end
 * of the part that came next, or to the end of the score when `to` lies beyond it. Continuing at the
 * measure that follows anyway removes a jump.
 */
export function setJump(measures: readonly Measure[], spans: readonly RecordingSpan[], after: Occurrence, to: MeasureId): RecordingSpan[] {
  const score = getIds(measures);
  const indices = getScoreIndices(score);
  const target = indices.get(to);
  if (target === undefined) {
    throw new RangeError(`Measure ${to} does not exist.`);
  }

  const position = findPosition(expandRecording(measures, spans), after);
  if (position === undefined) {
    throw new RangeError(`Measure ${after.measure} is not played ${after.occurrence} times.`);
  }

  const [head, rest] = splitSpansAfter(score, spans, position);
  const containing = rest.findIndex(span => indices.get(span.from)! <= target && target <= indices.get(span.to)!);
  const next = rest[0];
  let continuation: RecordingSpan[];
  if (containing !== -1) {
    continuation = [{ from: to, to: rest[containing]!.to }, ...rest.slice(containing + 1)];
  } else if (next && target <= indices.get(next.to)!) {
    continuation = [{ from: to, to: next.to }, ...rest.slice(1)];
  } else {
    continuation = [{ from: to, to: score.at(-1)! }];
  }

  return normalizeSpans(measures, [...head, ...continuation]);
}

/** One span of the recording as the recording list shows it: "19 to 20, 2nd time, after 20". */
export type RecordingStretch = {
  span: RecordingSpan;
  /** Timeline positions of its first and last measure. */
  first: number;
  last: number;
  /** The occurrence of its first measure. */
  occurrence: number;
  /** Where the recording comes from, undefined for the first span. */
  after?: Occurrence;
};

export function getRecordingStretches(measures: readonly Measure[], spans: readonly RecordingSpan[]): RecordingStretch[] {
  const timeline = expandRecording(measures, spans);
  const indices = getScoreIndices(getIds(measures));
  let first = 0;

  return spans.map((span) => {
    const last = first + getSpanLength(indices, span) - 1;
    const previous = timeline[first - 1];
    const stretch: RecordingStretch = { span: { ...span }, first, last, occurrence: timeline[first]!.occurrence };
    if (previous) {
      stretch.after = { measure: previous.measure, occurrence: previous.occurrence };
    }

    first = last + 1;
    return stretch;
  });
}

// Text form

const RANGE_SEPARATOR = /\s*(?:-|–|\.\.)\s*/g;
const RECORDED_COUNT_SUFFIX = /^(.*?)\s*[x×]\s*(\d+)$/i;
const PART_SEPARATOR = ",";

export type RecordingParseResult
  = | { status: "ok"; spans: RecordingSpan[] }
    | { status: "invalid"; reason: string };

function isSameSpan(a: RecordingSpan, b: RecordingSpan): boolean {
  return a.from === b.from && a.to === b.to;
}

/** The spans by label, with back-to-back copies of a span counted, e.g. "0-20, 19-20 x3, 21-28". */
export function formatRecording(spans: readonly RecordingSpan[], measures: readonly Measure[]): string {
  const labels = new Map(measures.map(measure => [measure.id, measure.label]));
  const label = (id: MeasureId): string => labels.get(id) ?? id;
  const parts: string[] = [];

  for (let i = 0; i < spans.length;) {
    const span = spans[i]!;
    let count = 1;
    while (spans[i + count] && isSameSpan(spans[i + count]!, span)) {
      count++;
    }

    const text = span.from === span.to ? label(span.from) : `${label(span.from)}-${label(span.to)}`;
    parts.push(count > 1 ? `${text} x${count}` : text);
    i += count;
  }

  return parts.join(`${PART_SEPARATOR} `);
}

/** Labels match exactly, or regardless of case when that is unambiguous. */
function findByLabel(measures: readonly Measure[], text: string): Measure | undefined {
  const exact = measures.find(measure => measure.label === text);
  if (exact) {
    return exact;
  }

  const matches = measures.filter(measure => measure.label.toLowerCase() === text.toLowerCase());
  return matches.length === 1 ? matches[0] : undefined;
}

type ParsedSpans = { spans: RecordingSpan[] } | { reason: string };

function splitAtSeparator(text: string, separator: RegExpExecArray): [string, string] {
  return [text.slice(0, separator.index).trim(), text.slice(separator.index + separator[0].length).trim()];
}

// A label may itself contain a dash, so every separator is tried and only an unambiguous reading counts.
function findRangeReadings(measures: readonly Measure[], text: string): [Measure, Measure][] {
  return [...text.matchAll(RANGE_SEPARATOR)].flatMap((separator) => {
    const [from, to] = splitAtSeparator(text, separator).map(label => findByLabel(measures, label));
    return from && to ? [[from, to] as [Measure, Measure]] : [];
  });
}

function describeUnknownRange(measures: readonly Measure[], text: string): string {
  const [separator] = text.matchAll(RANGE_SEPARATOR);
  if (!separator) {
    return `There is no measure "${text}".`;
  }

  const [from, to] = splitAtSeparator(text, separator);
  const unknown = findByLabel(measures, from) ? to : from;
  return unknown === "" ? `"${text}" is missing a measure.` : `There is no measure "${unknown}".`;
}

function parseSpan(measures: readonly Measure[], text: string): ParsedSpans {
  const single = findByLabel(measures, text);
  if (single) {
    return { spans: [{ from: single.id, to: single.id }] };
  }

  const readings = findRangeReadings(measures, text);
  if (readings.length > 1) {
    return { reason: `"${text}" can be read in more than one way.` };
  }

  const [range] = readings;
  if (!range) {
    return { reason: describeUnknownRange(measures, text) };
  }

  const [from, to] = range;
  if (measures.indexOf(from) > measures.indexOf(to)) {
    return { reason: `"${text}" runs backwards: ${to.label} comes before ${from.label} in the score.` };
  }

  return { spans: [{ from: from.id, to: to.id }] };
}

function parsePart(measures: readonly Measure[], part: string): ParsedSpans {
  const whole = parseSpan(measures, part);
  const suffix = part.match(RECORDED_COUNT_SUFFIX);
  if ("spans" in whole || !suffix) {
    return whole;
  }

  const counted = parseSpan(measures, suffix[1]!.trim());
  if ("reason" in counted) {
    return counted;
  }

  const count = parseInt(suffix[2]!, 10);
  if (!isRecordedCount(count)) {
    return { reason: `"${part}": a passage is recorded 1 to ${MAX_RECORDED_COUNT} times.` };
  }

  return { spans: Array.from({ length: count }, () => ({ ...counted.spans[0]! })) };
}

/**
 * Reads the text form of `formatRecording()`. Parts are separated by commas. A part is a label or a
 * range of labels ("19-20", also "19..20"), optionally followed by how many times it plays ("x3").
 */
export function parseRecording(text: string, measures: readonly Measure[]): RecordingParseResult {
  const parts = text.split(PART_SEPARATOR).map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { status: "invalid", reason: "The recording needs at least one measure, e.g. \"1-40\"." };
  }

  const spans: RecordingSpan[] = [];
  for (const part of parts) {
    const parsed = parsePart(measures, part);
    if ("reason" in parsed) {
      return { status: "invalid", reason: parsed.reason };
    }

    spans.push(...parsed.spans);
  }

  return { status: "ok", spans };
}

// Moving references

/**
 * Pairs every position of the old timeline with the position of the new one that plays the same measure
 * in an unchanged stretch, or undefined when the change removed it. It aligns both measure sequences by
 * their longest common subsequence and prefers earlier matches, so removing passes keeps the first ones.
 * `replacements` names measures of the old timeline that the new one plays as another measure.
 */
export function mapPositions(oldTimeline: Timeline, newTimeline: Timeline, replacements: ReadonlyMap<MeasureId, MeasureId> = new Map()): (number | undefined)[] {
  const before = getSequence(oldTimeline).map(measure => replacements.get(measure) ?? measure);
  const after = getSequence(newTimeline);
  const common = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));

  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      common[i]![j] = before[i] === after[j] ? common[i + 1]![j + 1]! + 1 : Math.max(common[i + 1]![j]!, common[i]![j + 1]!);
    }
  }

  const positions: (number | undefined)[] = before.map(() => undefined);
  for (let i = 0, j = 0; i < before.length && j < after.length;) {
    if (before[i] === after[j]) {
      positions[i++] = j++;
    } else if (common[i + 1]![j]! >= common[i]![j + 1]!) {
      i++;
    } else {
      j++;
    }
  }

  return positions;
}

/** Where an occurrence of the old timeline plays in the new one, or undefined when it no longer does. */
export type OccurrenceMap = (occurrence: Occurrence) => Occurrence | undefined;

/** Moves references by timeline position wherever their position survives, see `mapPositions()`. */
export function remapReferences(oldTimeline: Timeline, newTimeline: Timeline, replacements?: ReadonlyMap<MeasureId, MeasureId>): OccurrenceMap {
  const positions = mapPositions(oldTimeline, newTimeline, replacements);

  return (occurrence) => {
    const position = findPosition(oldTimeline, occurrence);
    const mapped = position === undefined ? undefined : positions[position];
    const entry = mapped === undefined ? undefined : newTimeline[mapped];
    return entry && { measure: entry.measure, occurrence: entry.occurrence };
  };
}

export function remapLocation(map: OccurrenceMap, location: Location): Location | undefined {
  const moved = map(location);
  return moved && { ...moved, beat: location.beat };
}

/** Measures of the score that the recording never plays, in score order. */
export function findUnplayedMeasures(measures: readonly Measure[], timeline: Timeline): Measure[] {
  const played = new Set(getSequence(timeline));
  return measures.filter(measure => !played.has(measure.id));
}
