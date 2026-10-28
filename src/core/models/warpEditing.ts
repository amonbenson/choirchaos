import type { MeasureId } from "./measure";
import { findPosition, type Occurrence, type RecordedPass, type RecordingStretch, type StoredWarpMarker, type Timeline, type TimelineEntry } from "./recording";

// Keeps neighbouring markers apart, so the warp map never contains two markers at the same time.
export const MIN_WARP_MARKER_GAP = 0.01;

/** How far one press of a nudge button or arrow key moves a marker, in seconds. */
export const NUDGE_STEP = 0.01;
export const LARGE_NUDGE_STEP = 0.1;

/**
 * Between two sync points the warp map assumes a steady tempo. Choirs and bands drift over longer
 * stretches, so the sync status names stretches with more measures than this.
 */
export const MAX_MEASURES_PER_SYNC_POINT = 8;

// Times closer than this count as equal, since they went through floating point arithmetic.
const TIME_EPSILON = 1e-9;

export type PositionedWarpMarker = StoredWarpMarker & { position: number };

type Edge = { position: number; time: number };

/** Timeline positions `first` to `last` that the warp map times from a single sync point or none. */
export type SyncGap = RecordedPass & { length: number };

export type SyncStatus = {
  count: number;
  /** Recorded passes without a sync point of their own. */
  unsyncedPasses: RecordedPass[];
  /** Stretches with more than `MAX_MEASURES_PER_SYNC_POINT` measures per sync point. */
  gaps: SyncGap[];
};

export function isSameOccurrence(a: Occurrence, b: Occurrence): boolean {
  return a.measure === b.measure && a.occurrence === b.occurrence;
}

/** A string that identifies a marker by its measure and occurrence, for views that need string IDs. */
export function getOccurrenceKey({ measure, occurrence }: Occurrence): string {
  return `${measure}#${occurrence}`;
}

/** The warp markers that resolve on the timeline, in timeline order. */
export function getPositionedWarpMarkers(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[]): PositionedWarpMarker[] {
  return warpMarkers
    .flatMap((marker) => {
      const position = findPosition(timeline, marker);
      return position === undefined ? [] : [{ ...marker, position }];
    })
    .sort((a, b) => a.position - b.position);
}

export function findWarpMarker(warpMarkers: readonly StoredWarpMarker[], occurrence: Occurrence): StoredWarpMarker | undefined {
  return warpMarkers.find(marker => isSameOccurrence(marker, occurrence));
}

function getEdges(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[], duration: number): Edge[] {
  return [
    { position: -1, time: 0 },
    ...getPositionedWarpMarkers(timeline, warpMarkers),
    { position: timeline.length, time: duration },
  ];
}

/**
 * Timeline positions that may receive a marker at the given time: those between the markers left and
 * right of it, so markers always stay in timeline order.
 */
export function getWarpMarkerCandidates(
  timeline: Timeline,
  warpMarkers: readonly StoredWarpMarker[],
  time: number,
  duration: number,
): TimelineEntry[] {
  if (time <= 0 || time >= duration) {
    return [];
  }

  const edges = getEdges(timeline, warpMarkers, duration);
  const rightIndex = edges.findIndex(edge => edge.time > time);
  const left = edges[rightIndex - 1];
  const right = edges[rightIndex];

  if (!left || !right || time - left.time < MIN_WARP_MARKER_GAP || right.time - time < MIN_WARP_MARKER_GAP) {
    return [];
  }

  return timeline.slice(left.position + 1, right.position);
}

function clampAtPosition(edges: readonly Edge[], position: number, time: number): number {
  const previous = edges.filter(edge => edge.position < position).at(-1)!;
  const next = edges.find(edge => edge.position > position)!;
  // The first position may sit exactly at the start of the recording.
  const lower = previous.position < 0 ? 0 : previous.time + MIN_WARP_MARKER_GAP;
  const upper = next.time - MIN_WARP_MARKER_GAP;

  return Math.min(upper, Math.max(lower, time));
}

/** Clamps a dragged marker between its neighbours in timeline order. */
export function constrainWarpMarkerTime(
  timeline: Timeline,
  warpMarkers: readonly StoredWarpMarker[],
  marker: Occurrence,
  time: number,
  duration: number,
): number {
  const position = findPosition(timeline, marker);
  if (position === undefined) {
    return time;
  }

  return clampAtPosition(getEdges(timeline, warpMarkers, duration), position, time);
}

/**
 * The time a marker moves to when nudged by `delta` seconds from `time`, kept between its neighbours.
 * Nudges start from the shown time, which can be ahead of the stored one while a save is pending.
 */
export function nudgeWarpMarkerTime(
  timeline: Timeline,
  warpMarkers: readonly StoredWarpMarker[],
  marker: Occurrence,
  time: number,
  delta: number,
  duration: number,
): number {
  return constrainWarpMarkerTime(timeline, warpMarkers, marker, time + delta, duration);
}

/**
 * Whether the occurrence's marker may sit at `time`, its own marker aside: the recording plays the
 * occurrence, and the time lies between the markers before and after it in timeline order.
 */
export function canPlaceWarpMarker(
  timeline: Timeline,
  warpMarkers: readonly StoredWarpMarker[],
  occurrence: Occurrence,
  time: number,
  duration: number,
): boolean {
  const position = findPosition(timeline, occurrence);
  if (position === undefined || time < 0 || time > duration) {
    return false;
  }

  const others = warpMarkers.filter(marker => !isSameOccurrence(marker, occurrence));
  return Math.abs(clampAtPosition(getEdges(timeline, others, duration), position, time) - time) < TIME_EPSILON;
}

/**
 * Occurrences a marker can be given to while it keeps its time: those without a marker of their own
 * that lie between the marker's neighbours.
 */
export function getReassignCandidates(
  timeline: Timeline,
  warpMarkers: readonly StoredWarpMarker[],
  marker: Occurrence,
  duration: number,
): TimelineEntry[] {
  const stored = findWarpMarker(warpMarkers, marker);
  if (!stored) {
    return [];
  }

  const others = warpMarkers.filter(other => other !== stored);
  return timeline.filter(entry => !findWarpMarker(warpMarkers, entry) && canPlaceWarpMarker(timeline, others, entry, stored.time, duration));
}

function findGaps(positions: readonly number[], length: number): SyncGap[] {
  const starts = positions[0] === 0 ? positions : [0, ...positions];
  return starts
    .map((first, i) => {
      const last = (starts[i + 1] ?? length) - 1;
      return { first, last, length: last - first + 1 };
    })
    .filter(gap => gap.length > MAX_MEASURES_PER_SYNC_POINT);
}

/** How well the sync points cover the recording: passes without one, and stretches with too few. */
export function getSyncStatus(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[], passes: readonly RecordedPass[]): SyncStatus {
  const positions = getPositionedWarpMarkers(timeline, warpMarkers).map(marker => marker.position);
  const unsyncedPasses = passes
    .filter(({ first, last }) => !positions.some(position => position >= first && position <= last))
    .map(({ first, last }) => ({ first, last }));

  return { count: positions.length, unsyncedPasses, gaps: timeline.length === 0 ? [] : findGaps(positions, timeline.length) };
}

/**
 * Passes that play measures again, such as the later passes of a recorded repeat, without a sync point
 * where they start. Their timing is spread evenly from the sync points around them, which rarely matches
 * a recording that slows down or breathes before it goes back.
 */
export function findUnsyncedRepeatPasses(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[], stretches: readonly RecordingStretch[]): RecordingStretch[] {
  const synced = new Set(getPositionedWarpMarkers(timeline, warpMarkers).map(marker => marker.position));
  return stretches.filter(stretch => stretch.occurrence > 1 && !synced.has(stretch.first));
}

/** The occurrences of each measure that have a sync point, for the pins on the score. */
export function getSyncedOccurrences(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[]): Map<MeasureId, number[]> {
  const occurrences = new Map<MeasureId, number[]>();
  for (const { measure, occurrence } of getPositionedWarpMarkers(timeline, warpMarkers)) {
    occurrences.set(measure, [...occurrences.get(measure) ?? [], occurrence]);
  }

  return occurrences;
}

const SECONDS_PER_MINUTE = 60;
const SYNC_TIME_PATTERN = /^(?:(\d+):)?(\d+(?:[.,]\d*)?)$/;

/** "0:52.140", minutes, seconds and milliseconds of the recording. */
export function formatSyncTime(seconds: number): string {
  const milliseconds = Math.round(Math.max(0, seconds) * 1000);
  const minutes = Math.floor(milliseconds / (SECONDS_PER_MINUTE * 1000));
  const rest = (milliseconds - minutes * SECONDS_PER_MINUTE * 1000) / 1000;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

/** Reads "0:52.140", "52.14" or "1:05", or returns undefined. Seconds after minutes stay below 60. */
export function parseSyncTime(text: string): number | undefined {
  const match = SYNC_TIME_PATTERN.exec(text.trim());
  if (!match) {
    return undefined;
  }

  const seconds = Number(match[2]!.replace(",", "."));
  if (match[1] === undefined) {
    return seconds;
  }

  return seconds < SECONDS_PER_MINUTE ? Number(match[1]) * SECONDS_PER_MINUTE + seconds : undefined;
}

function assertFreeOccurrence(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[], occurrence: Occurrence): void {
  if (findPosition(timeline, occurrence) === undefined) {
    throw new Error(`Measure ${occurrence.measure} is not played ${occurrence.occurrence} times.`);
  }

  if (findWarpMarker(warpMarkers, occurrence)) {
    throw new Error(`Measure ${occurrence.measure} already has a warp marker.`);
  }
}

export function addWarpMarker(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[], marker: StoredWarpMarker): StoredWarpMarker[] {
  assertFreeOccurrence(timeline, warpMarkers, marker);
  return [...warpMarkers, { ...marker }];
}

export function moveWarpMarker(warpMarkers: readonly StoredWarpMarker[], occurrence: Occurrence, time: number): StoredWarpMarker[] {
  return warpMarkers.map(marker => isSameOccurrence(marker, occurrence) ? { ...marker, time } : marker);
}

/**
 * Gives a warp marker to another occurrence and keeps its time, which rescues the sync after a
 * recording change moved a measure. The target must lie between the marker's neighbours.
 */
export function reassignWarpMarker(timeline: Timeline, warpMarkers: readonly StoredWarpMarker[], from: Occurrence, to: Occurrence): StoredWarpMarker[] {
  const marker = findWarpMarker(warpMarkers, from);
  if (!marker) {
    throw new Error(`Measure ${from.measure} has no warp marker on its occurrence ${from.occurrence}.`);
  }

  if (isSameOccurrence(from, to)) {
    return [...warpMarkers];
  }

  assertFreeOccurrence(timeline, warpMarkers, to);
  const others = warpMarkers.filter(other => other !== marker);
  if (!canPlaceWarpMarker(timeline, others, to, marker.time, Infinity)) {
    throw new Error(`Measure ${to.measure} does not lie between the neighbouring warp markers.`);
  }

  return [...others, { measure: to.measure, occurrence: to.occurrence, time: marker.time }];
}

export function removeWarpMarker(warpMarkers: readonly StoredWarpMarker[], occurrence: Occurrence): StoredWarpMarker[] {
  return warpMarkers.filter(marker => !isSameOccurrence(marker, occurrence));
}
