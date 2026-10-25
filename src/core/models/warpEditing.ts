import { findPosition, type Occurrence, type StoredWarpMarker, type Timeline, type TimelineEntry } from "./recording";

// Keeps neighbouring markers apart, so the warp map never contains two markers at the same time.
export const MIN_WARP_MARKER_GAP = 0.01;

export type PositionedWarpMarker = StoredWarpMarker & { position: number };

type Edge = { position: number; time: number };

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

  const edges = getEdges(timeline, warpMarkers, duration);
  const previous = edges.filter(edge => edge.position < position).at(-1)!;
  const next = edges.find(edge => edge.position > position)!;
  // The first position may sit exactly at the start of the recording.
  const lower = previous.position < 0 ? 0 : previous.time + MIN_WARP_MARKER_GAP;
  const upper = next.time - MIN_WARP_MARKER_GAP;

  return Math.min(upper, Math.max(lower, time));
}
