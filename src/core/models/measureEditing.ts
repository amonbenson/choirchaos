import { compareNumberings, isNumbering, type Numbering } from "../utils/numbering";
import Measure, { type MeasureLayout, withoutReview } from "./measure";

/**
 * In MIDI songs the beat map fixes the measures, so editing only moves boxes between them. Audio
 * songs own their measures, so editing may also create and rename them.
 */
export type MeasureEditMode = "midi" | "audio";

export type MeasureEdit = {
  layouts: Map<Measure, MeasureLayout | undefined>;
  beats: Map<Measure, number>;
  renames: Map<Measure, Numbering>;
  additions: Measure[];
  removals: Measure[];
  /** Boxes without a number that this edit numbers or removes. */
  resolvedBoxes: MeasureLayout[];
  /** The measures holding the edited boxes afterwards, so a selection can follow its boxes. */
  boxes: Measure[];
};

export type ConflictResolution = "swap" | "shift";

export type MeasureEditResult
  = | { status: "ok"; edit: MeasureEdit }
    | { status: "conflict"; conflict: Measure }
    | { status: "invalid"; reason: string };

export type MeasureRun = {
  first: Measure;
  last: Measure;
  count: number;
};

type Box = {
  layout: MeasureLayout;
  source?: Measure;
};

type PendingCreation = {
  value: Numbering;
  box: Box;
};

const DEFAULT_BEATS = 4;
const NUMBERING_LEADING_DIGITS = /^\d+/;

export function createEmptyEdit(): MeasureEdit {
  return { layouts: new Map(), beats: new Map(), renames: new Map(), additions: [], removals: [], resolvedBoxes: [], boxes: [] };
}

export function isEmptyEdit(edit: MeasureEdit): boolean {
  return edit.layouts.size === 0 && edit.beats.size === 0 && edit.renames.size === 0
    && edit.additions.length === 0 && edit.removals.length === 0 && edit.resolvedBoxes.length === 0;
}

/** Layout-only edits keep every measure's timing, so the player does not need to reload. */
export function changesPlayback(edit: MeasureEdit): boolean {
  return edit.beats.size > 0 || edit.renames.size > 0 || edit.additions.length > 0 || edit.removals.length > 0;
}

// ── Reading order ─────────────────────────────────────────────────────────────

function centerY(layout: MeasureLayout): number {
  return layout.y + layout.height / 2;
}

function groupRows<T>(placed: T[], layoutOf: (item: T) => MeasureLayout): T[][] {
  const byCenter = [...placed].sort((a, b) => centerY(layoutOf(a)) - centerY(layoutOf(b)));
  const rows: { bottom: number; items: T[] }[] = [];

  for (const item of byCenter) {
    const layout = layoutOf(item);
    const row = rows.at(-1);
    if (row && centerY(layout) <= row.bottom) {
      row.items.push(item);
      row.bottom = Math.max(row.bottom, layout.y + layout.height);
    } else {
      rows.push({ bottom: layout.y + layout.height, items: [item] });
    }
  }

  return rows.map(row => row.items.sort((a, b) => layoutOf(a).x - layoutOf(b).x));
}

/**
 * Items with a box page by page, row by row and left to right, the way the score is read. Boxes
 * share a row when one's vertical center lies within the row, so slightly uneven staves still read
 * as one line.
 */
export function sortInReadingOrder<T>(items: readonly T[], layoutOf: (item: T) => MeasureLayout | undefined): T[] {
  const pages = new Map<number, T[]>();
  for (const item of items) {
    const layout = layoutOf(item);
    if (layout) {
      pages.set(layout.page, [...pages.get(layout.page) ?? [], item]);
    }
  }

  return [...pages.keys()]
    .sort((a, b) => a - b)
    .flatMap(page => groupRows(pages.get(page)!, item => layoutOf(item)!).flat());
}

/** Placed measures in reading order. */
export function getReadingOrder(measures: readonly Measure[]): Measure[] {
  return sortInReadingOrder(measures, measure => measure.layout);
}

/** All placed measures from one to the other in reading order, both included. */
export function getMeasuresBetween(measures: readonly Measure[], from: Measure, to: Measure): Measure[] {
  const ordered = getReadingOrder(measures);
  const a = ordered.indexOf(from);
  const b = ordered.indexOf(to);
  if (a === -1 || b === -1) {
    return [];
  }

  return ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/** The placed measure that comes right before a box in reading order. */
export function getMeasureBefore(measures: readonly Measure[], layout: MeasureLayout): Measure | undefined {
  const probe = new Measure("0", 1, layout);
  const ordered = getReadingOrder([...measures, probe]);
  return ordered[ordered.indexOf(probe) - 1];
}

// ── Numbering ─────────────────────────────────────────────────────────────────

function incrementWholeNumber(value: Numbering): Numbering {
  const digits = value.match(NUMBERING_LEADING_DIGITS)?.[0] ?? "0";
  return String(parseInt(digits, 10) + 1);
}

function findMeasure(measures: readonly Measure[], value: Numbering): Measure | undefined {
  return measures.find(measure => measure.value === value);
}

function findMeasureAfter(measures: readonly Measure[], value: Numbering): Measure | undefined {
  return measures.find(measure => compareNumberings(measure.value, value) > 0);
}

/**
 * The measure that follows a number. MIDI songs only know the measures of their beat map. Audio
 * songs continue with the next whole number, unless an existing measure such as "4a" comes first.
 */
export function getNextNumber(measures: readonly Measure[], value: Numbering, mode: MeasureEditMode): Numbering | undefined {
  const following = findMeasureAfter(measures, value)?.value;
  if (mode === "midi") {
    return following;
  }

  const nextWhole = incrementWholeNumber(value);
  return following && compareNumberings(following, nextWhole) < 0 ? following : nextWhole;
}

function firstNumber(measures: readonly Measure[], mode: MeasureEditMode): Numbering | undefined {
  return measures[0]?.value ?? (mode === "audio" ? "1" : undefined);
}

/** The number a new box starts with: the measure after the box before it in reading order. */
export function getDefaultFirstNumber(measures: readonly Measure[], layout: MeasureLayout, mode: MeasureEditMode): Numbering | undefined {
  const before = getMeasureBefore(measures, layout);
  return before ? getNextNumber(measures, before.value, mode) : firstNumber(measures, mode);
}

/** A new box gets the beats of the measure before it, since time signatures rarely change. */
export function getDefaultBeats(measures: readonly Measure[], layout: MeasureLayout): number {
  return getMeasureBefore(measures, layout)?.beats ?? measures.at(-1)?.beats ?? DEFAULT_BEATS;
}

/** The shared beats of all given measures, or undefined when they differ. */
export function getCommonBeats(measures: readonly Measure[]): number | undefined {
  const beats = new Set(measures.map(measure => measure.beats));
  return beats.size === 1 ? [...beats][0] : undefined;
}

/** Runs of consecutive measures without a box, in the order of the measure list. */
export function getUnplacedRuns(measures: readonly Measure[]): MeasureRun[] {
  const runs: MeasureRun[] = [];
  let current: MeasureRun | undefined;

  for (const measure of measures) {
    if (measure.layout) {
      current = undefined;
    } else if (current) {
      current.last = measure;
      current.count++;
    } else {
      current = { first: measure, last: measure, count: 1 };
      runs.push(current);
    }
  }

  return runs;
}

// ── Placing boxes ─────────────────────────────────────────────────────────────

function validateStart(measures: readonly Measure[], start: Numbering, mode: MeasureEditMode): string | undefined {
  if (!isNumbering(start)) {
    return `"${start}" is not a measure number.`;
  }

  if (mode === "midi" && !findMeasure(measures, start)) {
    return `Measure ${start} is not in the beat map.`;
  }

  return undefined;
}

function takeOccupant(measures: readonly Measure[], slot: Numbering, sources: Set<Measure>): Measure | undefined {
  const existing = findMeasure(measures, slot);
  return existing?.layout && !sources.has(existing) ? existing : undefined;
}

/**
 * Puts boxes on consecutive measures from `start` on. A box already on one of those measures is in
 * the way. Without `shift` that is a conflict. With `shift` it moves on to the next measure, and so
 * on, until a measure without a box takes the last one.
 */
function planPlacement(
  measures: readonly Measure[],
  boxes: Box[],
  start: Numbering,
  mode: MeasureEditMode,
  { shift, beats }: { shift: boolean; beats?: number },
): MeasureEditResult {
  const invalid = validateStart(measures, start, mode);
  if (invalid) {
    return { status: "invalid", reason: invalid };
  }

  const edit = createEmptyEdit();
  const sources = new Set(boxes.flatMap(box => box.source ? [box.source] : []));
  sources.forEach(source => edit.layouts.set(source, undefined));

  const queue = [...boxes];
  const creations: PendingCreation[] = [];
  const targets: (Measure | PendingCreation)[] = [];
  let slot: Numbering | undefined = start;

  while (queue.length > 0) {
    if (slot === undefined) {
      return { status: "invalid", reason: "The beat map has no more measures for these boxes." };
    }

    const occupant = takeOccupant(measures, slot, sources);
    if (occupant && !shift) {
      return { status: "conflict", conflict: occupant };
    }

    if (occupant) {
      queue.push({ layout: occupant.layout!, source: occupant });
    }

    const box = queue.shift()!;
    const existing = findMeasure(measures, slot);
    if (existing) {
      edit.layouts.set(existing, box.layout);
      targets.push(existing);
    } else {
      const creation = { value: slot, box };
      creations.push(creation);
      targets.push(creation);
    }

    slot = getNextNumber(measures, slot, mode);
  }

  const created = new Map(creations.map(creation => [creation, resolveCreation(edit, creation, beats)]));
  edit.boxes = targets.slice(0, boxes.length).map(target => target instanceof Measure ? target : created.get(target)!);
  return { status: "ok", edit: withoutUnchangedLayouts(edit) };
}

/**
 * A measure number that does not exist yet (audio songs only). When the box left a measure that
 * keeps no other box, that measure is renamed instead, so renumbering does not leave empty
 * measures behind.
 */
function resolveCreation(edit: MeasureEdit, { value, box }: PendingCreation, beats: number | undefined): Measure {
  const source = box.source;
  const sourceIsFree = source && edit.layouts.get(source) === undefined && !edit.renames.has(source);
  if (sourceIsFree) {
    edit.layouts.set(source, box.layout);
    edit.renames.set(source, value);
    return source;
  }

  const measure = new Measure(value, beats ?? source?.beats ?? DEFAULT_BEATS, box.layout);
  edit.additions.push(measure);
  return measure;
}

function withoutUnchangedLayouts(edit: MeasureEdit): MeasureEdit {
  for (const [measure, layout] of edit.layouts) {
    if (measure.layout === layout && !edit.renames.has(measure)) {
      edit.layouts.delete(measure);
    }
  }

  return edit;
}

function planSwap(measures: readonly Measure[], measure: Measure, target: Numbering): MeasureEditResult {
  const other = findMeasure(measures, target);
  if (!other) {
    return { status: "invalid", reason: `Measure ${target} does not exist.` };
  }

  const edit = createEmptyEdit();
  edit.layouts.set(measure, other.layout);
  edit.layouts.set(other, measure.layout && withoutReview(measure.layout));
  edit.boxes = [other];
  return { status: "ok", edit };
}

/**
 * Gives the selected boxes consecutive numbers from `start` on, in reading order. Swapping is only
 * possible for a single box. Renumbering a box counts as checking it, so it loses its review flag.
 */
export function planRenumber(
  measures: readonly Measure[],
  selected: readonly Measure[],
  start: Numbering,
  mode: MeasureEditMode,
  resolution?: ConflictResolution,
): MeasureEditResult {
  const ordered = getReadingOrder(selected);
  const single = ordered.length === 1 ? ordered[0] : undefined;
  if (resolution === "swap" && single) {
    return planSwap(measures, single, start);
  }

  const boxes = ordered.map(measure => ({ layout: withoutReview(measure.layout!), source: measure }));
  return planPlacement(measures, boxes, start, mode, { shift: resolution === "shift" });
}

/** Splits a box into equally wide measures. */
export function splitLayout(layout: MeasureLayout, count: number): MeasureLayout[] {
  const width = layout.width / count;
  return Array.from({ length: count }, (_, i) => ({ ...layout, x: layout.x + width * i, width }));
}

/**
 * Places a newly drawn box holding `count` measures. Audio songs create the measures that do not
 * exist yet with the given beats.
 */
export function planNewBox(
  measures: readonly Measure[],
  layout: MeasureLayout,
  { count, start, beats }: { count: number; start: Numbering; beats: number },
  mode: MeasureEditMode,
  resolution?: "shift",
): MeasureEditResult {
  const boxes = splitLayout(layout, count).map(part => ({ layout: part }));
  return planPlacement(measures, boxes, start, mode, { shift: resolution === "shift", beats });
}

// ── Bulk edits ────────────────────────────────────────────────────────────────

export function planBeats(selected: readonly Measure[], beats: number): MeasureEdit {
  const edit = createEmptyEdit();
  selected.filter(measure => measure.beats !== beats).forEach(measure => edit.beats.set(measure, beats));
  edit.boxes = [...selected];
  return edit;
}

export function planRemoveBoxes(selected: readonly Measure[]): MeasureEdit {
  const edit = createEmptyEdit();
  selected.forEach(measure => edit.layouts.set(measure, undefined));
  return edit;
}

export function planDeleteMeasures(selected: readonly Measure[]): MeasureEdit {
  const edit = createEmptyEdit();
  edit.removals = [...selected];
  return edit;
}

/** Normalizes a box drawn in any direction to a positive width and height. */
export function normalizeLayout(layout: MeasureLayout): MeasureLayout {
  return {
    page: layout.page,
    x: Math.min(layout.x, layout.x + layout.width),
    y: Math.min(layout.y, layout.y + layout.height),
    width: Math.abs(layout.width),
    height: Math.abs(layout.height),
  };
}

export function intersects(a: MeasureLayout, b: MeasureLayout): boolean {
  return a.page === b.page
    && a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}
