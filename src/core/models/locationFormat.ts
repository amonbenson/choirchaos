import { countOccurrences, type Occurrence } from "./recording";
import type Song from "./song";
import { isRecordingEnd, type SyncPlace } from "./warpEditing";

const ORDINAL_SUFFIXES: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
const ordinalRules = new Intl.PluralRules("en-US", { type: "ordinal" });

export function formatOrdinal(value: number): string {
  return `${value}${ORDINAL_SUFFIXES[ordinalRules.select(value)]}`;
}

/** "2nd time", as the occurrence picker offers it. */
export function formatTimes(occurrence: number): string {
  return `${formatOrdinal(occurrence)} time`;
}

/** The measure label with the occurrence when the measure has already played before, e.g. "12, 2nd time". */
export function formatOccurrence(label: string, occurrence: number): string {
  return occurrence > 1 ? `${label}, ${formatTimes(occurrence)}` : label;
}

/** The short form for the marker chip on the waveform, e.g. "12 (2nd)". */
export function formatOccurrenceShort(label: string, occurrence: number): string {
  return occurrence > 1 ? `${label} (${formatOrdinal(occurrence)})` : label;
}

/**
 * "12", or "12, 2nd time" for a measure the recording plays more than once. Unlike `formatOccurrence`,
 * it also names the first time, since a location input offers every occurrence of such a measure.
 */
export function formatLocation(song: Song, { measure, occurrence }: Occurrence): string {
  const label = song.findMeasure(measure)?.label ?? "?";
  return countOccurrences(song.getTimeline(), measure) > 1 ? `${label}, ${formatTimes(occurrence)}` : label;
}

/** "12, 2nd time" like `formatLocation`, or "the end of 32" for the end sync point. */
export function formatSyncPlace(song: Song, place: SyncPlace): string {
  if (!isRecordingEnd(place)) {
    return formatLocation(song, place);
  }

  const last = song.getTimeline().at(-1);
  return last ? `the end of ${formatLocation(song, last)}` : "the end";
}
