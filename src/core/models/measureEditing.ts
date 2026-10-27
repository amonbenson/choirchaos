import Measure, {
  createEmptyMeasureEdit,
  isSameLayout,
  type MeasureEdit,
  type MeasureId,
  type MeasureLayout,
  needsReview,
  withoutReview,
} from "./measure";
import { type ParsedLabel, parseLabel, suggestLabel } from "./measureLabel";

/**
 * In MIDI songs the beat map fixes the measures, so editing only moves boxes between them. Audio
 * songs own their measures, so editing may also create and relabel them.
 */
export type MeasureEditMode = "midi" | "audio";

/** A measure that holds an edited box afterwards: an existing one, or the n-th addition of the edit. */
export type BoxTarget = { measure: MeasureId } | { addition: number };

/** An edit together with the boxes it places, so a selection can follow its boxes. */
export type PlannedEdit = {
  edit: MeasureEdit;
  boxes: BoxTarget[];
};

export type ConflictResolution = "swap" | "shift";

export type MeasureEditResult
  = | ({ status: "ok" } & PlannedEdit)
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

/** A measure the placement wants to create. Its ID is unknown until the song saves it. */
type Creation = {
  measure: Measure;
  box: Box;
};

const DEFAULT_BEATS = 4;
const PLANNED_ID = "";

export function createPlannedEdit(edit: MeasureEdit = createEmptyMeasureEdit(), boxes: BoxTarget[] = []): PlannedEdit {
  return { edit, boxes };
}

/** The boxes of `all` that are not in `removed`, compared by position. */
export function withoutBoxes(all: readonly MeasureLayout[], removed: readonly MeasureLayout[]): MeasureLayout[] {
  return all.filter(box => !removed.some(other => isSameLayout(box, other)));
}

function isSameBox(a: MeasureLayout | undefined, b: MeasureLayout | undefined): boolean {
  if (!a || !b) {
    return a === b;
  }

  return isSameLayout(a, b) && needsReview(a) === needsReview(b);
}

function findByLabel(measures: readonly Measure[], label: string): Measure | undefined {
  return measures.find(measure => measure.label === label);
}

// Reading order

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
export function getMeasuresBetween(measures: readonly Measure[], from: MeasureId, to: MeasureId): Measure[] {
  const ordered = getReadingOrder(measures);
  const a = ordered.findIndex(measure => measure.id === from);
  const b = ordered.findIndex(measure => measure.id === to);
  if (a === -1 || b === -1) {
    return [];
  }

  return ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
}

function getNeighbours(
  measures: readonly Measure[],
  layout: MeasureLayout,
  layoutOf: (measure: Measure) => MeasureLayout | undefined,
): { before?: Measure; after?: Measure } {
  const probe = new Measure(PLANNED_ID, "", DEFAULT_BEATS, layout);
  const ordered = sortInReadingOrder([...measures, probe], measure => measure === probe ? layout : layoutOf(measure));
  const index = ordered.indexOf(probe);
  return { before: ordered[index - 1], after: ordered[index + 1] };
}

/** The placed measure that comes right before a box in reading order. */
export function getMeasureBefore(measures: readonly Measure[], layout: MeasureLayout): Measure | undefined {
  return getNeighbours(measures, layout, measure => measure.layout).before;
}

/**
 * Where a new measure with this box goes in the score: right after the measure before it in reading
 * order, else right before the one after it, else at the end.
 */
export function findScoreIndexForBox(
  measures: readonly Measure[],
  layout: MeasureLayout,
  layoutOf: (measure: Measure) => MeasureLayout | undefined = measure => measure.layout,
): number {
  const { before, after } = getNeighbours(measures, layout, layoutOf);
  if (before) {
    return measures.indexOf(before) + 1;
  }

  return after ? measures.indexOf(after) : measures.length;
}

// Labels

/** The label a new box starts with: the one after the box before it in reading order. */
export function getDefaultLabel(measures: readonly Measure[], layout: MeasureLayout, mode: MeasureEditMode): string | undefined {
  return suggestLabel(measures, getMeasureBefore(measures, layout), mode);
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

/** Runs of consecutive measures without a box, in score order. */
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

/** The labels the planned boxes end up with, in the order of `planned.boxes`. */
export function getPlannedLabels(measures: readonly Measure[], { edit, boxes }: PlannedEdit): string[] {
  return boxes.map((target) => {
    if ("addition" in target) {
      return edit.additions[target.addition]!.label;
    }

    const measure = measures.find(candidate => candidate.id === target.measure);
    return edit.relabels.get(target.measure) ?? measure?.label ?? "";
  });
}

// Placing boxes

function validateStart(measures: readonly Measure[], start: string, mode: MeasureEditMode): string | undefined {
  if (!start) {
    return "Enter a measure number.";
  }

  if (mode === "midi" && !findByLabel(measures, start)) {
    return `Measure ${start} is not in the beat map.`;
  }

  return undefined;
}

/**
 * The label after `previous` in the planned score. Audio labels that do not parse continue with the
 * next measure of the score.
 */
function getNextLabel(score: readonly Measure[], previous: Measure, mode: MeasureEditMode): string | undefined {
  return suggestLabel(score, previous, mode) ?? score[score.indexOf(previous) + 1]?.label;
}

/** Collects one placement on a copy of the score, where planned measures sit at their future index. */
class Placement {
  public readonly edit = createEmptyMeasureEdit();
  private readonly score: Measure[];
  private readonly creations: Creation[] = [];
  private readonly targets: Measure[] = [];
  private readonly sources: Set<MeasureId>;

  constructor(
    private readonly measures: readonly Measure[],
    private readonly boxes: readonly Box[],
    private readonly beats: number | undefined,
  ) {
    this.score = [...measures];
    this.sources = new Set(boxes.flatMap(box => box.source ? [box.source.id] : []));
    this.sources.forEach(id => this.edit.layouts.set(id, undefined));
  }

  public findOccupant(label: string): Measure | undefined {
    const existing = findByLabel(this.measures, label);
    return existing?.layout && !this.sources.has(existing.id) ? existing : undefined;
  }

  public place(label: string, box: Box): Measure {
    const existing = findByLabel(this.measures, label);
    if (existing) {
      this.edit.layouts.set(existing.id, box.layout);
      this.targets.push(existing);
      return existing;
    }

    const measure = new Measure(PLANNED_ID, label, this.beats ?? box.source?.beats ?? DEFAULT_BEATS, box.layout);
    this.score.splice(this.findCreationIndex(box.layout), 0, measure);
    this.creations.push({ measure, box });
    this.targets.push(measure);
    return measure;
  }

  public getScore(): readonly Measure[] {
    return this.score;
  }

  /** Follows the previous target, or the box's reading order position for the first one. */
  private findCreationIndex(layout: MeasureLayout): number {
    const previous = this.targets.at(-1);
    if (previous) {
      return this.score.indexOf(previous) + 1;
    }

    return findScoreIndexForBox(this.score, layout, measure => this.sources.has(measure.id) ? undefined : measure.layout);
  }

  public finish(): PlannedEdit {
    const relabeled = new Map(this.creations.map(creation => [creation.measure, this.relabelSource(creation)]));
    const remaining = this.score.filter(measure => !relabeled.get(measure));
    const additions = this.creations.filter(creation => !relabeled.get(creation.measure)).map(creation => creation.measure);

    for (const measure of additions) {
      this.edit.additions.push({ label: measure.label, beats: measure.beats, layout: measure.layout, index: remaining.indexOf(measure) });
    }

    this.dropUnchangedLayouts();
    const boxes = this.targets.slice(0, this.boxes.length).map((target): BoxTarget => {
      const source = relabeled.get(target);
      if (source) {
        return { measure: source.id };
      }

      const addition = additions.indexOf(target);
      return addition === -1 ? { measure: target.id } : { addition };
    });

    return { edit: this.edit, boxes };
  }

  /**
   * A label nobody has yet (audio songs only). When the box left a measure that keeps no other box,
   * that measure is relabeled instead, so renumbering does not leave empty measures behind.
   */
  private relabelSource({ measure, box }: Creation): Measure | undefined {
    const source = box.source;
    const isFree = source && this.edit.layouts.get(source.id) === undefined && !this.edit.relabels.has(source.id);
    if (!isFree) {
      return undefined;
    }

    this.edit.layouts.set(source.id, box.layout);
    this.edit.relabels.set(source.id, measure.label);
    return source;
  }

  private dropUnchangedLayouts(): void {
    for (const [id, layout] of this.edit.layouts) {
      const measure = this.measures.find(candidate => candidate.id === id);
      if (measure && isSameBox(measure.layout, layout) && !this.edit.relabels.has(id)) {
        this.edit.layouts.delete(id);
      }
    }
  }
}

/**
 * Puts boxes on consecutive measures from `start` on. A box already on one of those measures is in
 * the way. Without `shift` that is a conflict. With `shift` it moves on to the next measure, and so
 * on, until a measure without a box takes the last one.
 */
function planPlacement(
  measures: readonly Measure[],
  boxes: Box[],
  start: string,
  mode: MeasureEditMode,
  { shift, beats }: { shift: boolean; beats?: number },
): MeasureEditResult {
  const invalid = validateStart(measures, start, mode);
  if (invalid) {
    return { status: "invalid", reason: invalid };
  }

  const placement = new Placement(measures, boxes, beats);
  const queue = [...boxes];
  const visited = new Set<string>();
  let label: string | undefined = start;

  while (queue.length > 0) {
    if (label === undefined || visited.has(label)) {
      const reason = mode === "midi" ? "The beat map has no more measures for these boxes." : "No measure number follows the last one.";
      return { status: "invalid", reason };
    }

    visited.add(label);
    const occupant = placement.findOccupant(label);
    if (occupant && !shift) {
      return { status: "conflict", conflict: occupant };
    }

    if (occupant) {
      queue.push({ layout: occupant.layout!, source: occupant });
    }

    const target = placement.place(label, queue.shift()!);
    label = getNextLabel(placement.getScore(), target, mode);
  }

  return { status: "ok", ...placement.finish() };
}

function planSwap(measures: readonly Measure[], measure: Measure, label: string): MeasureEditResult {
  const other = findByLabel(measures, label);
  if (!other) {
    return { status: "invalid", reason: `Measure ${label} does not exist.` };
  }

  const edit = createEmptyMeasureEdit();
  edit.layouts.set(measure.id, other.layout);
  edit.layouts.set(other.id, measure.layout && withoutReview(measure.layout));
  return { status: "ok", edit, boxes: [{ measure: other.id }] };
}

/**
 * Gives the selected boxes consecutive labels from `start` on, in reading order. Swapping is only
 * possible for a single box. Renumbering a box counts as checking it, so it loses its review flag.
 */
export function planRenumber(
  measures: readonly Measure[],
  selected: readonly Measure[],
  start: string,
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
  { count, start, beats }: { count: number; start: string; beats: number },
  mode: MeasureEditMode,
  resolution?: "shift",
): MeasureEditResult {
  const boxes = splitLayout(layout, count).map(part => ({ layout: part }));
  return planPlacement(measures, boxes, start, mode, { shift: resolution === "shift", beats });
}

// Adding measures without boxes

function compareParsedLabels(a: ParsedLabel, b: ParsedLabel): number {
  return a.number !== b.number ? a.number - b.number : a.letter.localeCompare(b.letter);
}

/** Before the first measure whose label comes after it, so "4a" lands between "4" and "5". Others go last. */
function findScoreIndexForLabel(score: readonly Measure[], label: string): number {
  const parsed = parseLabel(label);
  if (!parsed) {
    return score.length;
  }

  const index = score.findIndex((measure) => {
    const other = parseLabel(measure.label);
    return other !== undefined && compareParsedLabels(other, parsed) > 0;
  });
  return index === -1 ? score.length : index;
}

/** Labels of the list that the song already has. */
export function findExistingLabels(measures: readonly Measure[], labels: readonly string[]): string[] {
  return labels.filter(label => findByLabel(measures, label));
}

/** Adds measures without boxes (audio songs only), placed among the measures by their labels. */
export function planAddMeasures(measures: readonly Measure[], labels: readonly string[], beats: number): PlannedEdit {
  const score = [...measures];
  const added: Measure[] = [];
  for (const label of new Set(labels)) {
    const measure = new Measure(PLANNED_ID, label, beats);
    score.splice(findScoreIndexForLabel(score, label), 0, measure);
    added.push(measure);
  }

  const edit = createEmptyMeasureEdit();
  edit.additions = added.map(measure => ({ label: measure.label, beats, index: score.indexOf(measure) }));
  return createPlannedEdit(edit);
}

// Bulk edits

function toTargets(measures: readonly Measure[]): BoxTarget[] {
  return measures.map(measure => ({ measure: measure.id }));
}

export function planBeats(selected: readonly Measure[], beats: number): PlannedEdit {
  const edit = createEmptyMeasureEdit();
  selected.filter(measure => measure.beats !== beats).forEach(measure => edit.beats.set(measure.id, beats));
  return createPlannedEdit(edit, toTargets(selected));
}

/** Moves boxes to other positions, e.g. after resizing them on the score. */
export function planLayouts(changes: readonly [Measure, MeasureLayout][]): PlannedEdit {
  const edit = createEmptyMeasureEdit();
  changes.forEach(([measure, layout]) => edit.layouts.set(measure.id, layout));
  return createPlannedEdit(edit, toTargets(changes.map(([measure]) => measure)));
}

export type BoxEdge = "top" | "right" | "bottom" | "left";

const SAME_EDGE_TOLERANCE = 0.01;

function isSameEdge(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_EDGE_TOLERANCE;
}

/** The boxes on the same page whose top and bottom line up with the box, in score order. */
function getStaff(measures: readonly Measure[], layout: MeasureLayout): Measure[] {
  return measures.filter(other => other.layout?.page === layout.page
    && isSameEdge(other.layout.y, layout.y)
    && isSameEdge(other.layout.y + other.layout.height, layout.y + layout.height));
}

/**
 * The layouts after moving one edge of a measure's box by `delta` page fractions. The top and bottom edges
 * move with the whole staff. The left and right edges are shared with the neighbour in the staff, which moves too.
 */
export function resizeBox(measures: readonly Measure[], measure: Measure, edge: BoxEdge, delta: { x: number; y: number }): [Measure, MeasureLayout][] {
  const layout = measure.layout;
  if (!layout) {
    return [];
  }

  const staff = getStaff(measures, layout);
  const index = staff.indexOf(measure);
  const moveEdge = (box: Measure | undefined, change: (layout: MeasureLayout) => Partial<MeasureLayout>): [Measure, MeasureLayout][] =>
    box?.layout ? [[box, { ...box.layout, ...change(box.layout) }]] : [];
  const moveLeft = (box: MeasureLayout): Partial<MeasureLayout> => ({ x: box.x + delta.x, width: box.width - delta.x });
  const moveRight = (box: MeasureLayout): Partial<MeasureLayout> => ({ width: box.width + delta.x });

  switch (edge) {
    case "top":
      return staff.flatMap(box => moveEdge(box, other => ({ y: other.y + delta.y, height: other.height - delta.y })));
    case "bottom":
      return staff.flatMap(box => moveEdge(box, other => ({ height: other.height + delta.y })));
    case "left":
      return [...moveEdge(measure, moveLeft), ...moveEdge(staff[index - 1], moveRight)];
    case "right":
      return [...moveEdge(measure, moveRight), ...moveEdge(staff[index + 1], moveLeft)];
  }
}

function resolveBoxes(edit: MeasureEdit, all: readonly MeasureLayout[], resolved: readonly MeasureLayout[]): void {
  if (resolved.length > 0) {
    edit.unnumberedBoxes = withoutBoxes(all, resolved);
  }
}

/** Takes the boxes off the selected measures and removes the selected boxes without a number. */
export function planRemoveBoxes(
  selected: readonly Measure[],
  selectedUnnumbered: readonly MeasureLayout[] = [],
  allUnnumbered: readonly MeasureLayout[] = selectedUnnumbered,
): PlannedEdit {
  const edit = createEmptyMeasureEdit();
  selected.forEach(measure => edit.layouts.set(measure.id, undefined));
  resolveBoxes(edit, allUnnumbered, selectedUnnumbered);
  return createPlannedEdit(edit);
}

/** Deletes the selected measures (audio songs only), together with the selected boxes without a number. */
export function planDeleteMeasures(
  selected: readonly Measure[],
  selectedUnnumbered: readonly MeasureLayout[] = [],
  allUnnumbered: readonly MeasureLayout[] = selectedUnnumbered,
): PlannedEdit {
  const edit = createEmptyMeasureEdit();
  edit.removals = selected.map(measure => measure.id);
  resolveBoxes(edit, allUnnumbered, selectedUnnumbered);
  return createPlannedEdit(edit);
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
