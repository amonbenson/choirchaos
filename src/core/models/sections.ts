import type Measure from "./measure";
import type { MeasureId } from "./measure";
import {
  compareLocations,
  deserializeLocation,
  findPosition,
  findRecordedPasses,
  type Location,
  type RecordedPass,
  serializeLocation,
  type StoredLocation,
  type Timeline,
  validateLocation,
} from "./recording";

export type SectionKind = "cut" | "repeat" | "vamp" | "caesura";
export type VampOut = "onEnd" | "anyBar" | "anyBeat";
export type VampVocals = "all" | "first" | "last" | "split";

/** `from` and `to` are both inclusive, so `to` is the section's last beat. */
type Range<L> = { from: L; to: L };

/** Plays its range no times. */
export type CutSection<L = Location> = Range<L> & { kind: "cut" };

/** Plays its range `passes` times in total. */
export type RepeatSection<L = Location> = Range<L> & { kind: "repeat"; passes: number };

/** Plays its range until released. */
export type VampSection<L = Location> = Range<L> & { kind: "vamp"; out: VampOut; vocals: VampVocals };

/**
 * Pauses playback before the beat `at`, where playback arrives by playing on or by leaving a section,
 * but not by going round a repeat or vamp again.
 */
export type CaesuraSection<L = Location> = { kind: "caesura"; at: L };

/** A section over a range of beats. */
export type RangeSection = CutSection | RepeatSection | VampSection;

export type Section = RangeSection | CaesuraSection;

export type StoredSection
  = | CutSection<StoredLocation>
    | RepeatSection<StoredLocation>
    | VampSection<StoredLocation>
    | CaesuraSection<StoredLocation>;

export const VAMP_OUTS: readonly VampOut[] = ["onEnd", "anyBar", "anyBeat"];
export const VAMP_VOCALS: readonly VampVocals[] = ["all", "first", "last", "split"];

export const DEFAULT_REPEAT_PASSES = 2;
export const DEFAULT_VAMP_OUT: VampOut = "onEnd";
export const DEFAULT_VAMP_VOCALS: VampVocals = "all";

export function isCaesura(section: Section): section is CaesuraSection {
  return section.kind === "caesura";
}

export function isRangeSection(section: Section): section is RangeSection {
  return section.kind !== "caesura";
}

export function getRangeSections(sections: readonly Section[]): RangeSection[] {
  return sections.filter(isRangeSection);
}

export function getCaesuras(sections: readonly Section[]): CaesuraSection[] {
  return sections.filter(isCaesura);
}

/** Where the section starts, which for a caesura is its location. */
export function getSectionStart(section: Section): Location {
  return isCaesura(section) ? section.at : section.from;
}

export function createSection(kind: RangeSection["kind"], from: Location, to: Location): RangeSection {
  switch (kind) {
    case "cut":
      return { kind, from, to };
    case "repeat":
      return { kind, from, to, passes: DEFAULT_REPEAT_PASSES };
    case "vamp":
      return { kind, from, to, out: DEFAULT_VAMP_OUT, vocals: DEFAULT_VAMP_VOCALS };
  }
}

export function serializeSection(section: Section): StoredSection {
  if (isCaesura(section)) {
    return { kind: section.kind, at: serializeLocation(section.at) };
  }

  return { ...section, from: serializeLocation(section.from), to: serializeLocation(section.to) };
}

export function deserializeSection(stored: StoredSection): Section {
  if (stored.kind === "caesura") {
    return { kind: stored.kind, at: deserializeLocation(stored.at) };
  }

  return { ...stored, from: deserializeLocation(stored.from), to: deserializeLocation(stored.to) };
}

/** Where the section's own range lies in the recording, which is its first recorded pass. */
export function getSectionRun(timeline: Timeline, section: RangeSection): RecordedPass | undefined {
  const first = findPosition(timeline, section.from);
  const last = findPosition(timeline, section.to);
  return first === undefined || last === undefined || last < first ? undefined : { first, last };
}

/** The first position after `after` where one of the range sections starts. Caesuras bound no passes. */
function findNextSectionStart(timeline: Timeline, sections: readonly Section[], after: number): number {
  const starts = getRangeSections(sections).map(other => findPosition(timeline, other.from) ?? Infinity);
  return Math.min(...starts.filter(start => start > after));
}

/**
 * The recorded passes a section plays. A cut covers exactly its own range. A repeat or vamp also takes in
 * the directly following repetitions of its range, but none from where another section starts.
 */
export function getSectionPasses(timeline: Timeline, sections: readonly Section[], section: RangeSection): RecordedPass[] {
  const run = getSectionRun(timeline, section);
  if (!run || section.kind === "cut") {
    return run ? [run] : [];
  }

  const next = findNextSectionStart(timeline, sections, run.first);
  const [first, ...later] = findRecordedPasses(timeline, section);
  return [first!, ...later.filter(pass => pass.last < next)];
}

/** Positions and beats a section covers in the recording, counting all its recorded passes. */
export type SectionExtent = {
  from: { position: number; beat: number };
  to: { position: number; beat: number };
};

export function getSectionExtent(timeline: Timeline, sections: readonly Section[], section: RangeSection): SectionExtent | undefined {
  const passes = getSectionPasses(timeline, sections, section);
  const last = passes.at(-1);
  if (!last) {
    return undefined;
  }

  return {
    from: { position: passes[0]!.first, beat: section.from.beat },
    to: { position: last.last, beat: section.to.beat },
  };
}

function isBefore(a: SectionExtent["from"], b: SectionExtent["from"]): boolean {
  return a.position < b.position || (a.position === b.position && a.beat < b.beat);
}

function overlaps(a: SectionExtent, b: SectionExtent): boolean {
  return !isBefore(a.to, b.from) && !isBefore(b.to, a.from);
}

function validateKindFields(section: RangeSection): string | undefined {
  switch (section.kind) {
    case "cut":
      return undefined;
    case "repeat":
      return Number.isInteger(section.passes) && section.passes >= 1 ? undefined : "A repeat needs at least 1 pass.";
    case "vamp":
      return VAMP_OUTS.includes(section.out) && VAMP_VOCALS.includes(section.vocals) ? undefined : "A vamp needs a valid out and vocals mode.";
  }
}

/** Why a single section cannot be played, or undefined when it can. */
export function validateSection(measures: readonly Measure[], timeline: Timeline, section: Section): string | undefined {
  if (isCaesura(section)) {
    return validateLocation(measures, timeline, section.at);
  }

  const locationError = validateLocation(measures, timeline, section.from) ?? validateLocation(measures, timeline, section.to);
  if (locationError) {
    return locationError;
  }

  if (compareLocations(timeline, section.from, section.to) >= 0) {
    return "A section must start before it ends.";
  }

  return validateKindFields(section);
}

export type SectionIssue = { index: number; reason: string };

/**
 * Problems of every section, including overlaps with the range sections before it. A caesura may lie
 * inside any section, but two caesuras never share a location.
 */
export function validateSections(measures: readonly Measure[], timeline: Timeline, sections: readonly Section[]): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const extents: SectionExtent[] = [];
  const caesuras: Location[] = [];

  sections.forEach((section, index) => {
    const reason = validateSection(measures, timeline, section);
    if (reason) {
      issues.push({ index, reason });
      return;
    }

    if (isCaesura(section)) {
      if (caesuras.some(other => isSameStart(other, section.at))) {
        issues.push({ index, reason: "There already is a caesura here." });
        return;
      }

      caesuras.push(section.at);
      return;
    }

    const extent = getSectionExtent(timeline, sections, section)!;
    if (extents.some(other => overlaps(extent, other))) {
      issues.push({ index, reason: "Sections must not overlap." });
      return;
    }

    extents.push(extent);
  });

  return issues;
}

export function compareSections(timeline: Timeline, a: Section, b: Section): number {
  return compareLocations(timeline, getSectionStart(a), getSectionStart(b));
}

/** The sections without `replaced`, plus `added`. Sections are found by identity, so one write can replace several. */
export function replaceSections(sections: readonly Section[], replaced: readonly Section[], added?: Section): Section[] {
  return [...sections.filter(section => !replaced.includes(section)), ...added ? [added] : []];
}

/** Two range section starts are the same section, since range sections never overlap and caesuras never share a location. */
export function isSameStart(a: Location, b: Location): boolean {
  return a.measure === b.measure && a.occurrence === b.occurrence && a.beat === b.beat;
}

export function findSection(sections: readonly Section[], from: Location): RangeSection | undefined {
  return getRangeSections(sections).find(section => isSameStart(section.from, from));
}

export function findCaesura(sections: readonly Section[], at: Location): CaesuraSection | undefined {
  return getCaesuras(sections).find(section => isSameStart(section.at, at));
}

/** A section range over whole measures: from the first beat of the run's first measure to the last beat of its last. */
export function toMeasureRange(measures: readonly Measure[], timeline: Timeline, run: RecordedPass): { from: Location; to: Location } {
  const first = timeline[run.first]!;
  const last = timeline[run.last]!;
  const beats = measures.find(measure => measure.id === last.measure)?.beats ?? 1;
  return {
    from: { measure: first.measure, occurrence: first.occurrence, beat: 0 },
    to: { measure: last.measure, occurrence: last.occurrence, beat: beats - 1 },
  };
}

/** The section snapped to whole measures of a run, keeping its kind and settings. */
export function withRun<T extends RangeSection>(measures: readonly Measure[], timeline: Timeline, section: T, run: RecordedPass): T {
  return { ...section, ...toMeasureRange(measures, timeline, run) };
}

/**
 * Where a caesura after the run goes: before the first beat of the position the recording plays next.
 * Undefined when the run ends the recording.
 */
export function getCaesuraAfter(timeline: Timeline, run: RecordedPass): Location | undefined {
  const next = timeline[run.last + 1];
  return next && { measure: next.measure, occurrence: next.occurrence, beat: 0 };
}

/** The position of a measure closest to `near` within `min..max`, where a range handle dropped on its box lands. */
export function findNearestPosition(timeline: Timeline, measure: MeasureId, near: number, min: number, max: number): number | undefined {
  return timeline
    .filter(entry => entry.measure === measure && entry.position >= min && entry.position <= max)
    .reduce<number | undefined>((best, { position }) => best === undefined || Math.abs(position - near) < Math.abs(best - near) ? position : best, undefined);
}

/** Range sections that share a played measure with the run, counting all their recorded passes. */
export function findSectionsAt(timeline: Timeline, sections: readonly Section[], run: RecordedPass): RangeSection[] {
  return getRangeSections(sections).filter((section) => {
    const extent = getSectionExtent(timeline, sections, section);
    return extent && extent.to.position >= run.first && extent.from.position <= run.last;
  });
}

/** Whether the section, with all its recorded passes, holds the whole run. */
export function holdsRun(timeline: Timeline, sections: readonly Section[], section: RangeSection, run: RecordedPass): boolean {
  const extent = getSectionExtent(timeline, sections, section);
  return !!extent && extent.from.position <= run.first && run.last <= extent.to.position;
}
