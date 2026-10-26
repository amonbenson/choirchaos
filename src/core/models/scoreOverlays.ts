import { formatTimes } from "./locationFormat";
import type { Marker } from "./markers";
import type Measure from "./measure";
import type { MeasureId, MeasureLayout } from "./measure";
import { countOccurrences, findRecordedPasses, type Timeline } from "./recording";
import type { Section } from "./sections";

/**
 * One line of boxes that an overlay covers, in page fractions: from the left edge of its first box to the
 * right edge of its last box, at the top of its highest box.
 */
export type OverlayRun = {
  page: number;
  x: number;
  y: number;
  width: number;
  measures: MeasureId[];
};

export type SectionOverlay = {
  /** Index into the song's sections. */
  index: number;
  section: Section;
  /** The measures of the section's first pass in playing order, each once. */
  measures: MeasureId[];
  /** One run per score row the first pass touches, in playing order. */
  runs: OverlayRun[];
  /** Sections drawn on the same boxes stack upwards, 0 is closest to the boxes. */
  lane: number;
};

/** A passage the recording plays `times` times back to back. Its first pass is at `first..last`. */
export type RecordedRepeat = {
  first: number;
  last: number;
  times: number;
  measures: MeasureId[];
};

export type MarkerOverlay = { measure: MeasureId; texts: string[] };

/** The section state the score shows while that section plays. */
export type PlayingSection = { section: number; pass: number; passes?: number; released: boolean };

type Placed = { measure: MeasureId; layout: MeasureLayout };

const KIND_NAMES: Record<Section["kind"], string> = { cut: "Cut", repeat: "Repeat", vamp: "Vamp" };

function centerY(layout: MeasureLayout): number {
  return layout.y + layout.height / 2;
}

function contains(layout: MeasureLayout, y: number): boolean {
  return layout.y <= y && y <= layout.y + layout.height;
}

/** The root guide's row rule: boxes share a row when one's vertical center lies inside the other. */
function isSameRow(a: MeasureLayout, b: MeasureLayout): boolean {
  return a.page === b.page && (contains(a, centerY(b)) || contains(b, centerY(a)));
}

function continuesRun(previous: MeasureLayout, next: MeasureLayout): boolean {
  return isSameRow(previous, next) && next.x >= previous.x;
}

function toRun(boxes: readonly Placed[]): OverlayRun {
  const first = boxes[0]!.layout;
  const last = boxes.at(-1)!.layout;
  return {
    page: first.page,
    x: first.x,
    y: Math.min(...boxes.map(box => box.layout.y)),
    width: last.x + last.width - first.x,
    measures: boxes.map(box => box.measure),
  };
}

/**
 * Splits boxes given in playing order into lines that can be drawn as one bar: a new run starts at a new
 * page, a new row, or wherever the playing order goes back to the left. Measures without a box are skipped.
 */
export function splitIntoRuns(measures: readonly Measure[], ids: readonly MeasureId[]): OverlayRun[] {
  const runs: Placed[][] = [];
  for (const id of ids) {
    const layout = measures.find(measure => measure.id === id)?.layout;
    if (!layout) {
      continue;
    }

    const run = runs.at(-1);
    if (run && continuesRun(run.at(-1)!.layout, layout)) {
      run.push({ measure: id, layout });
    } else {
      runs.push([{ measure: id, layout }]);
    }
  }

  return runs.map(toRun);
}

function uniqueMeasures(timeline: Timeline, first: number, last: number): MeasureId[] {
  return [...new Set(timeline.slice(first, last + 1).map(entry => entry.measure))];
}

function findLane(earlier: readonly SectionOverlay[], measures: readonly MeasureId[]): number {
  const sharing = earlier.filter(other => other.measures.some(measure => measures.includes(measure)));
  return sharing.length === 0 ? 0 : Math.max(...sharing.map(other => other.lane)) + 1;
}

/** Where each section is drawn on the score. Sections that do not resolve in the recording are left out. */
export function getSectionOverlays(measures: readonly Measure[], timeline: Timeline, sections: readonly Section[]): SectionOverlay[] {
  const overlays: SectionOverlay[] = [];
  sections.forEach((section, index) => {
    const [pass] = findRecordedPasses(timeline, section);
    if (!pass) {
      return;
    }

    const ids = uniqueMeasures(timeline, pass.first, pass.last);
    overlays.push({ index, section, measures: ids, runs: splitIntoRuns(measures, ids), lane: findLane(overlays, ids) });
  });

  return overlays;
}

function isRepetition(timeline: Timeline, first: number, length: number, start: number): boolean {
  for (let offset = 0; offset < length; offset++) {
    if (timeline[start + offset]?.measure !== timeline[first + offset]!.measure) {
      return false;
    }
  }

  return true;
}

function findPreviousOccurrence(timeline: Timeline, position: number): number {
  const { measure, occurrence } = timeline[position]!;
  return timeline.findIndex(entry => entry.measure === measure && entry.occurrence === occurrence - 1);
}

/**
 * Passages the recording plays back to back, such as written repeats and recorded vamps. A passage starts
 * where the recording returns to a measure it played before and repeats everything since then. Returns that
 * play on differently (endings, D.S.) are not repetitions.
 */
export function findRecordedRepeats(timeline: Timeline): RecordedRepeat[] {
  const repeats: RecordedRepeat[] = [];
  let position = 1;
  while (position < timeline.length) {
    const first = timeline[position]!.occurrence > 1 ? findPreviousOccurrence(timeline, position) : -1;
    const length = position - first;
    if (first === -1 || !isRepetition(timeline, first, length, position)) {
      position++;
      continue;
    }

    let times = 2;
    while (isRepetition(timeline, first, length, first + times * length)) {
      times++;
    }

    repeats.push({ first, last: position - 1, times, measures: uniqueMeasures(timeline, first, position - 1) });
    position = first + times * length;
  }

  return repeats;
}

/** Markers grouped by measure, so a measure with markers on several occurrences shows one chip. */
export function getMarkerOverlays(markers: readonly Marker[]): MarkerOverlay[] {
  const byMeasure = new Map<MeasureId, string[]>();
  for (const { at, text } of markers) {
    byMeasure.set(at.measure, [...byMeasure.get(at.measure) ?? [], text]);
  }

  return [...byMeasure].map(([measure, texts]) => ({ measure, texts }));
}

function labelOf(measures: readonly Measure[], id: MeasureId): string {
  return measures.find(measure => measure.id === id)?.label ?? "?";
}

function formatCount(times: number): string {
  return times === 1 ? "once" : `${times} times`;
}

function formatRange(measures: readonly Measure[], { from, to }: Section): string {
  const range = from.measure === to.measure
    ? labelOf(measures, from.measure)
    : `${labelOf(measures, from.measure)} to ${labelOf(measures, to.measure)}`;
  return from.occurrence > 1 ? `${range}, ${formatTimes(from.occurrence)}` : range;
}

function formatPlannedPasses(section: Section): string | undefined {
  if (section.kind === "cut") {
    return undefined;
  }

  return section.kind === "vamp" && section.passes === 0 ? "until released" : formatCount(section.passes);
}

function formatPlayingPass({ pass, passes, released }: PlayingSection): string {
  if (released) {
    return "exiting";
  }

  return passes === undefined ? `pass ${pass}` : `pass ${pass} of ${passes}`;
}

/** The section being played and its pass, e.g. "Vamp pass 2 of 4". */
export function formatPlayingSection(kind: Section["kind"], playing: PlayingSection): string {
  return `${KIND_NAMES[kind]} ${formatPlayingPass(playing)}`;
}

/** The section and what it plays, e.g. "Vamp 19 to 20, until released" or, while it plays, "Repeat 14 to 15, pass 2 of 3". */
export function describeSection(measures: readonly Measure[], section: Section, playing?: PlayingSection): string {
  const passes = playing ? formatPlayingPass(playing) : formatPlannedPasses(section);
  const name = `${KIND_NAMES[section.kind]} ${formatRange(measures, section)}`;
  return passes ? `${name}, ${passes}` : name;
}

/** The short text of a section chip, e.g. "Repeat 3×", "Vamp, until released" or, while it plays, "Repeat 2/3". */
export function formatSectionChip(section: Section, playing?: PlayingSection): string {
  const kind = KIND_NAMES[section.kind];
  const occurrence = section.from.occurrence > 1 ? `, ${formatTimes(section.from.occurrence)}` : "";
  if (section.kind === "cut") {
    return `${kind}${occurrence}`;
  }

  if (playing) {
    if (playing.released) {
      return `${kind}, exiting`;
    }

    return playing.passes === undefined ? `${kind} ${playing.pass}` : `${kind} ${playing.pass}/${playing.passes}`;
  }

  const passes = section.kind === "vamp" && section.passes === 0 ? ", until released" : ` ${section.passes}×`;
  return `${kind}${passes}${occurrence}`;
}

function formatMarker(timeline: Timeline, { at, text }: Marker): string {
  return countOccurrences(timeline, at.measure) > 1 ? `Marker ${text}, ${formatTimes(at.occurrence)}` : `Marker ${text}`;
}

function append(descriptions: Map<MeasureId, string[]>, measures: readonly MeasureId[], text: string): void {
  for (const measure of measures) {
    descriptions.set(measure, [...descriptions.get(measure) ?? [], text]);
  }
}

export type OverlayDescriptionInput = {
  measures: readonly Measure[];
  timeline: Timeline;
  sections: readonly SectionOverlay[];
  repeats: readonly RecordedRepeat[];
  markers: readonly Marker[];
  playing?: PlayingSection;
};

/** What the overlays on each box say, for its `aria-describedby`: "Vamp 19 to 20, until released. Recorded 4 times. Marker D." */
export function describeOverlays({ measures, timeline, sections, repeats, markers, playing }: OverlayDescriptionInput): Map<MeasureId, string> {
  const descriptions = new Map<MeasureId, string[]>();
  for (const { index, section, measures: covered } of sections) {
    append(descriptions, covered, describeSection(measures, section, playing?.section === index ? playing : undefined));
  }

  for (const repeat of repeats) {
    append(descriptions, repeat.measures, `Recorded ${formatCount(repeat.times)}`);
  }

  for (const marker of markers) {
    append(descriptions, [marker.at.measure], formatMarker(timeline, marker));
  }

  return new Map([...descriptions].map(([measure, texts]) => [measure, `${texts.join(". ")}.`]));
}
