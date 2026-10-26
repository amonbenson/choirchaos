import { formatTimes } from "./locationFormat";
import type Measure from "./measure";
import type { MeasureId } from "./measure";
import { findPosition, type Location, type RecordedPass, type Timeline } from "./recording";
import { getSectionExtent, type Section } from "./sections";

/** Where selected measures play in the recording: one run of timeline positions, both inclusive. */
export type SelectedRun = RecordedPass;

/** How a section relates to a run: it is that run, contains it, or only overlaps it. */
export type SectionMatch = { index: number; section: Section; relation: "equal" | "contains" | "overlaps" };

/**
 * Every place where the recording plays exactly the selected measures, in score order and back to back.
 * A selection that plays nowhere like that is not consecutive and has no runs.
 */
export function findSelectedRuns(measures: readonly Measure[], timeline: Timeline, selected: ReadonlySet<MeasureId>): SelectedRun[] {
  const ordered = measures.filter(measure => selected.has(measure.id)).map(measure => measure.id);
  if (ordered.length === 0 || ordered.length !== selected.size) {
    return [];
  }

  const runs: SelectedRun[] = [];
  for (const { position } of timeline) {
    if (ordered.every((id, offset) => timeline[position + offset]?.measure === id)) {
      runs.push({ first: position, last: position + ordered.length - 1 });
    }
  }

  return runs;
}

function distanceTo(run: SelectedRun, position: number): number {
  if (position < run.first) {
    return run.first - position;
  }

  return position > run.last ? position - run.last : 0;
}

/** The run the playhead is in, or the one closest to it, so the selection follows the playhead. */
export function pickRun(runs: readonly SelectedRun[], playhead: number | undefined): SelectedRun | undefined {
  if (playhead === undefined) {
    return runs[0];
  }

  return runs.reduce<SelectedRun | undefined>((best, run) => !best || distanceTo(run, playhead) < distanceTo(best, playhead) ? run : best, undefined);
}

/** Sections that share a played measure with the run, counting all their recorded passes. */
export function findSectionsAt(timeline: Timeline, sections: readonly Section[], run: SelectedRun): SectionMatch[] {
  return sections.flatMap((section, index): SectionMatch[] => {
    const extent = getSectionExtent(timeline, section);
    if (!extent || extent.to.position < run.first || extent.from.position > run.last) {
      return [];
    }

    if (findPosition(timeline, section.from) === run.first && findPosition(timeline, section.to) === run.last) {
      return [{ index, section, relation: "equal" }];
    }

    const contains = extent.from.position <= run.first && run.last <= extent.to.position;
    return [{ index, section, relation: contains ? "contains" : "overlaps" }];
  });
}

/** The positions of a section's first pass, which its range handles move. */
export function getSectionRun(timeline: Timeline, section: Section): SelectedRun | undefined {
  const first = findPosition(timeline, section.from);
  const last = findPosition(timeline, section.to);
  return first === undefined || last === undefined ? undefined : { first, last };
}

/** A section range over whole measures: from the first beat of the run's first measure to the last beat of its last. */
export function toMeasureRange(measures: readonly Measure[], timeline: Timeline, run: SelectedRun): { from: Location; to: Location } {
  const first = timeline[run.first]!;
  const last = timeline[run.last]!;
  const beats = measures.find(measure => measure.id === last.measure)?.beats ?? 1;
  return {
    from: { measure: first.measure, occurrence: first.occurrence, beat: 0 },
    to: { measure: last.measure, occurrence: last.occurrence, beat: beats - 1 },
  };
}

/** The section snapped to whole measures of a run, keeping its kind and settings. */
export function withRun<T extends Section>(measures: readonly Measure[], timeline: Timeline, section: T, run: SelectedRun): T {
  return { ...section, ...toMeasureRange(measures, timeline, run) };
}

/** The position of a measure closest to `near` within `min..max`, where a range handle dropped on its box lands. */
export function findNearestPosition(timeline: Timeline, measure: MeasureId, near: number, min: number, max: number): number | undefined {
  return timeline
    .filter(entry => entry.measure === measure && entry.position >= min && entry.position <= max)
    .reduce<number | undefined>((best, { position }) => best === undefined || Math.abs(position - near) < Math.abs(best - near) ? position : best, undefined);
}

const KIND_NAMES: Record<Section["kind"], string> = { cut: "Cut", repeat: "Repeat", vamp: "Vamp" };

/** "Vamp 19 to 20", "Repeat 12" or "Cut 10 to 11, 2nd time": the section by its kind and measures. */
export function formatSectionName(measures: readonly Measure[], { kind, from, to }: Section): string {
  const label = (id: MeasureId): string => measures.find(measure => measure.id === id)?.label ?? "?";
  const range = from.measure === to.measure ? label(from.measure) : `${label(from.measure)} to ${label(to.measure)}`;
  return from.occurrence > 1 ? `${KIND_NAMES[kind]} ${range}, ${formatTimes(from.occurrence)}` : `${KIND_NAMES[kind]} ${range}`;
}
