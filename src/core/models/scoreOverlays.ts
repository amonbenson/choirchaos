import { formatOccurrence, formatOrdinal, formatTimes } from "./locationFormat";
import type { Marker } from "./markers";
import type Measure from "./measure";
import type { MeasureId, MeasureLayout } from "./measure";
import { countOccurrences, type Occurrence, type Timeline } from "./recording";
import { getSectionRun, type Section } from "./sections";

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

/** The section state the score shows while that section plays. */
export type PlayingSection = { section: number; pass: number; passes?: number; released: boolean };

type Placed = { measure: MeasureId; layout: MeasureLayout };

/**
 * Badges above the boxes stack in lanes, so sections that share boxes never cover each other. Each lane
 * holds a badge and, for a section, the bar under it. Lane 0 is closest to the boxes.
 */
export const LANE_HEIGHT_PX = 24;
export const BAR_GAP_PX = 2;
export const BAR_HEIGHT_PX = 3;
const LANE_BASE_PX = 2 * BAR_GAP_PX + BAR_HEIGHT_PX;

/** How far above the top of its boxes the badges of a lane end, in pixels. A section bar lies below that line. */
export function getLaneOffset(lane: number): number {
  return LANE_BASE_PX + lane * LANE_HEIGHT_PX;
}

/** How far above the top of its boxes the middle of a lane's section bar is, in pixels. */
export function getBarCenterOffset(lane: number): number {
  return getLaneOffset(lane) - BAR_GAP_PX - BAR_HEIGHT_PX / 2;
}

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
    const pass = getSectionRun(timeline, section);
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

/** A place where the recording does not go on with the next measure of the score, e.g. "after 8, 2nd time, to 9". */
export type RecordingJump = {
  /** Timeline position of the measure played before the jump. */
  position: number;
  after: Occurrence;
  to: Occurrence;
};

function isRepeatReturn(repeats: readonly RecordedRepeat[], position: number): boolean {
  return repeats.some(({ first, last, times }) => {
    const length = last - first + 1;
    const offset = position + 1 - first;
    return offset > 0 && offset % length === 0 && offset / length < times;
  });
}

/**
 * Every place where the recording continues somewhere other than the next measure of the score. Returns to
 * the start of a passage played back to back are left out, since the recorded-repeat glyph shows them.
 */
export function findRecordingJumps(measures: readonly Measure[], timeline: Timeline): RecordingJump[] {
  const indices = new Map(measures.map((measure, index) => [measure.id, index]));
  const repeats = findRecordedRepeats(timeline);
  const jumps: RecordingJump[] = [];

  for (let position = 0; position < timeline.length - 1; position++) {
    const current = timeline[position]!;
    const next = timeline[position + 1]!;
    if (indices.get(next.measure) === indices.get(current.measure)! + 1 || isRepeatReturn(repeats, position)) {
      continue;
    }

    jumps.push({
      position,
      after: { measure: current.measure, occurrence: current.occurrence },
      to: { measure: next.measure, occurrence: next.occurrence },
    });
  }

  return jumps;
}

/** The short text of a jump chip, e.g. "to 9" or "to 1, 2nd time". */
export function formatJumpChip(measures: readonly Measure[], jump: RecordingJump): string {
  return `to ${formatOccurrence(labelOf(measures, jump.to.measure), jump.to.occurrence)}`;
}

/** "After 8, 2nd time, the recording continues at 9". The first time is named when the measure plays more than once. */
export function describeJump(measures: readonly Measure[], timeline: Timeline, { after, to }: RecordingJump): string {
  const label = labelOf(measures, after.measure);
  const from = countOccurrences(timeline, after.measure) > 1 ? `${label}, ${formatTimes(after.occurrence)}` : label;
  return `After ${from}, the recording continues at ${formatOccurrence(labelOf(measures, to.measure), to.occurrence)}`;
}

function labelOf(measures: readonly Measure[], id: MeasureId): string {
  return measures.find(measure => measure.id === id)?.label ?? "?";
}

function formatCount(times: number): string {
  return times === 1 ? "once" : `${times} times`;
}

/** "14 to 15", "14 to 15, 2nd time", or "14, 1st time to 15, 2nd time" for a range across passes. */
function formatRange(measures: readonly Measure[], { from, to }: Section): string {
  if (from.occurrence !== to.occurrence) {
    return `${labelOf(measures, from.measure)}, ${formatTimes(from.occurrence)} to ${labelOf(measures, to.measure)}, ${formatTimes(to.occurrence)}`;
  }

  const range = from.measure === to.measure
    ? labelOf(measures, from.measure)
    : `${labelOf(measures, from.measure)} to ${labelOf(measures, to.measure)}`;
  return from.occurrence > 1 ? `${range}, ${formatTimes(from.occurrence)}` : range;
}

function formatPlannedPasses(section: Section): string | undefined {
  return section.kind === "repeat" ? formatCount(section.passes) : undefined;
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

/** The short text of the section being played and its pass, e.g. "Repeat 2/4" or "Vamp 3". */
export function formatSectionPass(kind: Section["kind"], { pass, passes }: PlayingSection): string {
  return passes === undefined ? `${KIND_NAMES[kind]} ${pass}` : `${KIND_NAMES[kind]} ${pass}/${passes}`;
}

/** "Vamp 19 to 20", "Repeat 12" or "Cut 10 to 11, 2nd time": the section by its kind and measures. */
export function formatSectionName(measures: readonly Measure[], section: Section): string {
  return `${KIND_NAMES[section.kind]} ${formatRange(measures, section)}`;
}

/** The section and what it plays, e.g. "Repeat 14 to 15, 3 times" or, while it plays, "Repeat 14 to 15, pass 2 of 3". */
export function describeSection(measures: readonly Measure[], section: Section, playing?: PlayingSection): string {
  const passes = playing ? formatPlayingPass(playing) : formatPlannedPasses(section);
  const name = formatSectionName(measures, section);
  return passes ? `${name}, ${passes}` : name;
}

/** The short text of a section chip, e.g. "Repeat 3×", "Vamp" or, while it plays, "Repeat 2/3". */
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

    return formatSectionPass(section.kind, playing);
  }

  const passes = section.kind === "repeat" ? ` ${section.passes}×` : "";
  return `${kind}${passes}${occurrence}`;
}

function formatMarker(timeline: Timeline, { at, text }: Marker): string {
  return countOccurrences(timeline, at.measure) > 1 ? `Marker ${text}, ${formatTimes(at.occurrence)}` : `Marker ${text}`;
}

/** One bar per score row of each section. Only the first bar's chip is named, the others repeat it. */
export type SectionBar = {
  key: string;
  section: Section;
  run: OverlayRun;
  lane: number;
  chip: string;
  name?: string;
};

export function getSectionBars(measures: readonly Measure[], overlays: readonly SectionOverlay[], playing?: PlayingSection): SectionBar[] {
  return overlays.flatMap(({ index, section, runs, lane }) => {
    const pass = playing?.section === index ? playing : undefined;
    const chip = formatSectionChip(section, pass);
    const name = describeSection(measures, section, pass);
    return runs.map((run, i) => ({ key: `section-${index}-${i}`, section, run, lane, chip, name: i === 0 ? name : undefined }));
  });
}

/** A badge's short text and the name screen readers hear instead. */
export type BoxBadge = { key: string; text: string; name: string };

export type MarkerBadge = { marker: Marker; name: string };

/** Everything the arrangement draws on and around one box. */
export type BoxOverlays = {
  /** What all overlays on the box say, for its `aria-describedby`: "Vamp 19 to 20. Recorded 4 times. Marker D." */
  description: string;
  /** On the last box of a passage the recording plays back to back. */
  recorded?: BoxBadge;
  /** The jumps after this box, in playing order. */
  jumps: BoxBadge[];
  markers: MarkerBadge[];
  /** The lane of the marker badges, above every section chip on the box. */
  markerLane: number;
  synced: boolean;
};

export type BoxOverlayInput = {
  measures: readonly Measure[];
  timeline: Timeline;
  sections: readonly SectionOverlay[];
  repeats: readonly RecordedRepeat[];
  markers: readonly Marker[];
  jumps?: readonly RecordingJump[];
  /** The occurrences of each measure that have a sync point. */
  synced?: ReadonlyMap<MeasureId, readonly number[]>;
  playing?: PlayingSection;
};

function describeRecordedRepeat(measures: readonly Measure[], repeat: RecordedRepeat): string {
  const labels = repeat.measures.map(id => labelOf(measures, id));
  const range = labels.length === 1 ? `Measure ${labels[0]}` : `Measures ${labels[0]} to ${labels.at(-1)}`;
  return `${range} recorded ${formatCount(repeat.times)}`;
}

function describeSyncPoints(timeline: Timeline, measure: MeasureId, occurrences: readonly number[]): string {
  if (countOccurrences(timeline, measure) < 2) {
    return "Sync point";
  }

  const times = occurrences.map(formatOrdinal);
  const list = times.length > 1 ? `${times.slice(0, -1).join(", ")} and ${times.at(-1)}` : times[0];
  return `Sync point on the ${list} time`;
}

type BoxOverlayDraft = Omit<BoxOverlays, "description"> & { texts: string[] };

/** The overlays of every box that has any, keyed by measure. */
export function getBoxOverlays(input: BoxOverlayInput): Map<MeasureId, BoxOverlays> {
  const { measures, timeline, sections, repeats, markers, jumps = [], synced = new Map(), playing } = input;
  const drafts = new Map<MeasureId, BoxOverlayDraft>();
  const draftOf = (measure: MeasureId): BoxOverlayDraft => {
    const existing = drafts.get(measure);
    if (existing) {
      return existing;
    }

    const draft: BoxOverlayDraft = { texts: [], jumps: [], markers: [], markerLane: 0, synced: false };
    drafts.set(measure, draft);
    return draft;
  };

  for (const { index, section, measures: covered, lane } of sections) {
    const text = describeSection(measures, section, playing?.section === index ? playing : undefined);
    for (const measure of covered) {
      const draft = draftOf(measure);
      draft.texts.push(text);
      draft.markerLane = Math.max(draft.markerLane, lane + 1);
    }
  }

  repeats.forEach((repeat, i) => {
    repeat.measures.forEach(measure => draftOf(measure).texts.push(`Recorded ${formatCount(repeat.times)}`));
    draftOf(repeat.measures.at(-1)!).recorded = { key: `recorded-${i}`, text: `×${repeat.times}`, name: describeRecordedRepeat(measures, repeat) };
  });

  for (const marker of markers) {
    const draft = draftOf(marker.at.measure);
    const name = formatMarker(timeline, marker);
    draft.texts.push(name);
    draft.markers.push({ marker, name });
  }

  for (const jump of jumps) {
    const draft = draftOf(jump.after.measure);
    const name = describeJump(measures, timeline, jump);
    draft.texts.push(name);
    draft.jumps.push({ key: `jump-${jump.position}`, text: formatJumpChip(measures, jump), name });
  }

  for (const [measure, occurrences] of synced) {
    const draft = draftOf(measure);
    draft.texts.push(describeSyncPoints(timeline, measure, occurrences));
    draft.synced = true;
  }

  return new Map([...drafts].map(([measure, { texts, ...overlays }]) => [measure, { ...overlays, description: `${texts.join(". ")}.` }]));
}
