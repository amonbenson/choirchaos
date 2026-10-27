import type Measure from "./measure";
import {
  compareLocations,
  deserializeLocation,
  findRecordedPasses,
  type Location,
  serializeLocation,
  type StoredLocation,
  type Timeline,
  validateLocation,
} from "./recording";

export type SectionKind = "cut" | "repeat" | "vamp";
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

export type Section = CutSection | RepeatSection | VampSection;

export type StoredSection = CutSection<StoredLocation> | RepeatSection<StoredLocation> | VampSection<StoredLocation>;

export const VAMP_OUTS: readonly VampOut[] = ["onEnd", "anyBar", "anyBeat"];
export const VAMP_VOCALS: readonly VampVocals[] = ["all", "first", "last", "split"];

export const DEFAULT_REPEAT_PASSES = 2;
export const DEFAULT_VAMP_OUT: VampOut = "onEnd";
export const DEFAULT_VAMP_VOCALS: VampVocals = "all";

export function createSection(kind: SectionKind, from: Location, to: Location): Section {
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
  return { ...section, from: serializeLocation(section.from), to: serializeLocation(section.to) };
}

export function deserializeSection(stored: StoredSection): Section {
  return { ...stored, from: deserializeLocation(stored.from), to: deserializeLocation(stored.to) };
}

/** Positions and beats a section covers in the recording, counting all its recorded passes. */
export type SectionExtent = {
  from: { position: number; beat: number };
  to: { position: number; beat: number };
};

export function getSectionExtent(timeline: Timeline, section: Section): SectionExtent | undefined {
  const passes = findRecordedPasses(timeline, section);
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

function validateKindFields(section: Section): string | undefined {
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

/** Problems of every section, including overlaps with the sections before it. */
export function validateSections(measures: readonly Measure[], timeline: Timeline, sections: readonly Section[]): SectionIssue[] {
  const issues: SectionIssue[] = [];
  const extents: SectionExtent[] = [];

  sections.forEach((section, index) => {
    const reason = validateSection(measures, timeline, section);
    if (reason) {
      issues.push({ index, reason });
      return;
    }

    const extent = getSectionExtent(timeline, section)!;
    if (extents.some(other => overlaps(extent, other))) {
      issues.push({ index, reason: "Sections must not overlap." });
      return;
    }

    extents.push(extent);
  });

  return issues;
}

export function compareSections(timeline: Timeline, a: Section, b: Section): number {
  return compareLocations(timeline, a.from, b.from);
}

/** The sections without `replaced`, plus `added`. Sections are found by identity, so one write can replace several. */
export function replaceSections(sections: readonly Section[], replaced: readonly Section[], added?: Section): Section[] {
  return [...sections.filter(section => !replaced.includes(section)), ...added ? [added] : []];
}
