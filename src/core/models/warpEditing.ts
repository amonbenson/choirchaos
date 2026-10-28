import type { SongLayers } from "./layers";
import type Measure from "./measure";
import { findPosition, type Occurrence, type StoredWarpMarker, type Timeline, type TimelineEntry } from "./recording";

// Keeps neighbouring markers apart, so the warp map never contains two markers at the same time.
export const MIN_WARP_MARKER_GAP = 0.01;

/** How far one press of a nudge button or arrow key moves a marker, in seconds. */
export const NUDGE_STEP = 0.01;
export const LARGE_NUDGE_STEP = 0.1;

/** The warp map needs a start and an end anchor before measures line up with the recording. */
export const MIN_SYNC_POINTS = 2;

// Times closer than this count as equal, since they went through floating point arithmetic.
const TIME_EPSILON = 1e-9;

/** The end of the recording's last measure, which has no occurrence of its own to start. */
export const RECORDING_END = "end";

/** Where a sync point sits: where an occurrence starts, or where the recording's last measure ends. */
export type SyncPlace = Occurrence | typeof RECORDING_END;

/** All sync points of a song: the warp markers and the optional one at the end. */
export type SyncPoints = Pick<SongLayers, "warpMarkers" | "endSyncTime">;

export type PositionedWarpMarker = StoredWarpMarker & { position: number };

export type PositionedSyncPoint = { place: SyncPlace; position: number; time: number };

type Edge = { position: number; time: number };

export function isSameOccurrence(a: Occurrence, b: Occurrence): boolean {
  return a.measure === b.measure && a.occurrence === b.occurrence;
}

export function isRecordingEnd(place: SyncPlace): place is typeof RECORDING_END {
  return place === RECORDING_END;
}

export function isSameSyncPlace(a: SyncPlace, b: SyncPlace): boolean {
  if (isRecordingEnd(a) || isRecordingEnd(b)) {
    return a === b;
  }

  return isSameOccurrence(a, b);
}

/** A string that identifies a marker by its measure and occurrence, for views that need string IDs. */
export function getOccurrenceKey({ measure, occurrence }: Occurrence): string {
  return `${measure}#${occurrence}`;
}

export function getSyncPlaceKey(place: SyncPlace): string {
  return isRecordingEnd(place) ? RECORDING_END : getOccurrenceKey(place);
}

/** The warp map position of a sync place: the end follows the last timeline position. */
export function findSyncPosition(timeline: Timeline, place: SyncPlace): number | undefined {
  if (isRecordingEnd(place)) {
    return timeline.length > 0 ? timeline.length : undefined;
  }

  return findPosition(timeline, place);
}

export function getSyncTime({ warpMarkers, endSyncTime }: SyncPoints, place: SyncPlace): number | undefined {
  return isRecordingEnd(place) ? endSyncTime : findWarpMarker(warpMarkers, place)?.time;
}

export function countSyncPoints({ warpMarkers, endSyncTime }: SyncPoints): number {
  return warpMarkers.length + (endSyncTime === undefined ? 0 : 1);
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

/** The sync points that resolve on the timeline, the end included, in timeline order. */
export function getPositionedSyncPoints(timeline: Timeline, sync: SyncPoints): PositionedSyncPoint[] {
  const points: PositionedSyncPoint[] = getPositionedWarpMarkers(timeline, sync.warpMarkers)
    .map(({ measure, occurrence, position, time }) => ({ place: { measure, occurrence }, position, time }));
  if (sync.endSyncTime !== undefined && timeline.length > 0) {
    points.push({ place: RECORDING_END, position: timeline.length, time: sync.endSyncTime });
  }

  return points;
}

export function findWarpMarker(warpMarkers: readonly StoredWarpMarker[], occurrence: Occurrence): StoredWarpMarker | undefined {
  return warpMarkers.find(marker => isSameOccurrence(marker, occurrence));
}

// The end of the audio file lies one position past the end sync point, so both can bound the sync points.
function getEdges(timeline: Timeline, sync: SyncPoints, duration: number): Edge[] {
  return [
    { position: -1, time: 0 },
    ...getPositionedSyncPoints(timeline, sync),
    { position: timeline.length + 1, time: duration },
  ];
}

export function removeSyncPoint({ warpMarkers, endSyncTime }: SyncPoints, place: SyncPlace): SyncPoints {
  return isRecordingEnd(place)
    ? { warpMarkers, endSyncTime: undefined }
    : { warpMarkers: removeWarpMarker(warpMarkers, place), endSyncTime };
}

/**
 * Places that may receive a sync point at the given time: those between the sync points left and right
 * of it, so sync points always stay in timeline order.
 */
export function getWarpMarkerCandidates(timeline: Timeline, sync: SyncPoints, time: number, duration: number): SyncPlace[] {
  if (time <= 0 || time >= duration || timeline.length === 0) {
    return [];
  }

  const edges = getEdges(timeline, sync, duration);
  const rightIndex = edges.findIndex(edge => edge.time > time);
  const left = edges[rightIndex - 1];
  const right = edges[rightIndex];

  if (!left || !right || time - left.time < MIN_WARP_MARKER_GAP || right.time - time < MIN_WARP_MARKER_GAP) {
    return [];
  }

  const entries: SyncPlace[] = timeline.slice(left.position + 1, right.position);
  const endIsFree = left.position < timeline.length && right.position > timeline.length;
  return endIsFree ? [...entries, RECORDING_END] : entries;
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
export function constrainWarpMarkerTime(timeline: Timeline, sync: SyncPoints, place: SyncPlace, time: number, duration: number): number {
  const position = findSyncPosition(timeline, place);
  if (position === undefined) {
    return time;
  }

  return clampAtPosition(getEdges(timeline, sync, duration), position, time);
}

/**
 * The time a marker moves to when nudged by `delta` seconds from `time`, kept between its neighbours.
 * Nudges start from the shown time, which can be ahead of the stored one while a save is pending.
 */
export function nudgeWarpMarkerTime(timeline: Timeline, sync: SyncPoints, place: SyncPlace, time: number, delta: number, duration: number): number {
  return constrainWarpMarkerTime(timeline, sync, place, time + delta, duration);
}

/**
 * Whether the place's sync point may sit at `time`, its own sync point aside: the recording plays the
 * place, and the time lies between the sync points before and after it in timeline order.
 */
export function canPlaceWarpMarker(timeline: Timeline, sync: SyncPoints, place: SyncPlace, time: number, duration: number): boolean {
  const position = findSyncPosition(timeline, place);
  if (position === undefined || time < 0 || time > duration) {
    return false;
  }

  const edges = getEdges(timeline, removeSyncPoint(sync, place), duration);
  return Math.abs(clampAtPosition(edges, position, time) - time) < TIME_EPSILON;
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

  // The end sync point never limits them, since the marker already sits before it.
  const others = { warpMarkers: warpMarkers.filter(other => other !== stored), endSyncTime: undefined };
  return timeline.filter(entry => !findWarpMarker(warpMarkers, entry) && canPlaceWarpMarker(timeline, others, entry, stored.time, duration));
}

/**
 * The warp map gives every measure between two sync points the same time, and goes on at the rate of
 * the first and last two beyond them. Recordings with a steady click therefore line up from two sync
 * points, except where measures timed at one rate differ in beats. For each such stretch this returns
 * the position to sync next: its first meter change without a sync point, else the end it extrapolates to.
 */
export function findMeterChangesToSync(timeline: Timeline, measures: readonly Measure[], sync: SyncPoints): number[] {
  const positions = getPositionedSyncPoints(timeline, sync).map(point => point.position);
  if (positions.length < MIN_SYNC_POINTS) {
    return [];
  }

  const beats = new Map(measures.map(measure => [measure.id, measure.beats]));
  const changes = timeline.slice(1)
    .filter(entry => beats.get(entry.measure) !== beats.get(timeline[entry.position - 1]!.measure))
    .map(entry => entry.position);
  const synced = new Set(positions);
  const bounds = [0, ...positions.slice(1, -1), timeline.length];

  return bounds.slice(0, -1).flatMap((first, i) => {
    const end = bounds[i + 1]!;
    const inside = changes.filter(position => position > first && position < end);
    if (inside.length === 0) {
      return [];
    }

    const extrapolatesEnd = end === timeline.length && !synced.has(end);
    const ends = [...i === 0 ? [0] : [], ...extrapolatesEnd ? [timeline.length - 1] : []];
    const target = [...inside, ...ends].find(position => !synced.has(position));
    return target === undefined ? [] : [target];
  });
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
  if (!canPlaceWarpMarker(timeline, { warpMarkers: others, endSyncTime: undefined }, to, marker.time, Infinity)) {
    throw new Error(`Measure ${to.measure} does not lie between the neighbouring warp markers.`);
  }

  return [...others, { measure: to.measure, occurrence: to.occurrence, time: marker.time }];
}

export function removeWarpMarker(warpMarkers: readonly StoredWarpMarker[], occurrence: Occurrence): StoredWarpMarker[] {
  return warpMarkers.filter(marker => !isSameOccurrence(marker, occurrence));
}

export function addSyncPoint(timeline: Timeline, sync: SyncPoints, place: SyncPlace, time: number): SyncPoints {
  if (!isRecordingEnd(place)) {
    return { ...sync, warpMarkers: addWarpMarker(timeline, sync.warpMarkers, { ...place, time }) };
  }

  if (timeline.length === 0) {
    throw new Error("The recording plays no measures.");
  }

  if (sync.endSyncTime !== undefined) {
    throw new Error("The end of the recording already has a sync point.");
  }

  return { ...sync, endSyncTime: time };
}

export function moveSyncPoint(sync: SyncPoints, place: SyncPlace, time: number): SyncPoints {
  return isRecordingEnd(place) ? { ...sync, endSyncTime: time } : { ...sync, warpMarkers: moveWarpMarker(sync.warpMarkers, place, time) };
}
