import type { Numbering } from "../utils/numbering";
import type Song from "./song";

// Keeps neighbouring markers apart, so the warp map never contains two markers at the same time.
export const MIN_WARP_MARKER_GAP = 0.01;

type Edge = { index: number; time: number };

function getEdges(song: Song, duration: number): Edge[] {
  const measures = song.measures.items();
  const markers = song.warpMarkers
    .map(marker => ({ index: measures.findIndex(m => m.value === marker.measure), time: marker.time }))
    .filter(edge => edge.index !== -1)
    .sort((a, b) => a.time - b.time);

  return [{ index: -1, time: 0 }, ...markers, { index: measures.length, time: duration }];
}

/**
 * Measures that may receive a marker at the given time: those between the markers left and right
 * of it, so markers always stay in measure order.
 */
export function getWarpMarkerCandidates(song: Song, time: number, duration: number): Numbering[] {
  if (time <= 0 || time >= duration) {
    return [];
  }

  const edges = getEdges(song, duration);
  const rightIndex = edges.findIndex(edge => edge.time > time);
  const left = edges[rightIndex - 1];
  const right = edges[rightIndex];

  if (!left || !right || time - left.time < MIN_WARP_MARKER_GAP || right.time - time < MIN_WARP_MARKER_GAP) {
    return [];
  }

  return song.measures.items().slice(left.index + 1, right.index).map(measure => measure.value);
}

/** Clamps a dragged marker between its neighbours. */
export function constrainWarpMarkerTime(song: Song, measure: Numbering, time: number, duration: number): number {
  const others = song.warpMarkers.filter(marker => marker.measure !== measure).map(marker => marker.time);
  const original = song.warpMarkers.find(marker => marker.measure === measure)?.time ?? time;
  const lower = Math.max(0, ...others.filter(t => t < original)) + MIN_WARP_MARKER_GAP;
  const upper = Math.min(duration, ...others.filter(t => t > original)) - MIN_WARP_MARKER_GAP;

  return Math.min(upper, Math.max(lower, time));
}
