import type { Numbering } from "../utils/numbering";
import type Measure from "./measure";
import { isSameLayout, type MeasureLayout, needsReview, withoutReview } from "./measure";
import {
  createEmptyEdit,
  getDefaultBeats,
  type MeasureEdit,
  type MeasureEditMode,
  type MeasureEditResult,
  planNewBox,
  sortInReadingOrder,
} from "./measureEditing";

/**
 * Something detection left for the user to check: a measure whose box it is unsure about, or a box
 * it could not give a number. Unnumbered boxes have no measure.
 */
export type ReviewItem = {
  layout: MeasureLayout;
  measure?: Measure;
};

export function countReviewItems(measures: readonly Measure[], unnumbered: readonly MeasureLayout[]): number {
  return measures.filter(measure => needsReview(measure.layout)).length + unnumbered.length;
}

/** Everything left to check, in reading order, so stepping through it follows the score. */
export function getReviewItems(measures: readonly Measure[], unnumbered: readonly MeasureLayout[]): ReviewItem[] {
  const flagged = measures.filter(measure => needsReview(measure.layout)).map(measure => ({ layout: measure.layout!, measure }));
  const boxes = unnumbered.map(layout => ({ layout }));
  return sortInReadingOrder([...flagged, ...boxes], item => item.layout);
}

export function isSameReviewItem(a: ReviewItem, b: ReviewItem): boolean {
  if (a.measure || b.measure) {
    return a.measure === b.measure;
  }

  return isSameLayout(a.layout, b.layout);
}

function findReviewIndex(items: readonly ReviewItem[], item: ReviewItem | undefined): number {
  return item ? items.findIndex(other => isSameReviewItem(other, item)) : -1;
}

/**
 * The item before or after the current one, wrapping around at the ends. Without a current item it
 * starts at the first or the last one.
 */
export function getAdjacentReviewItem(items: readonly ReviewItem[], current: ReviewItem | undefined, direction: 1 | -1): ReviewItem | undefined {
  if (items.length === 0) {
    return undefined;
  }

  const index = findReviewIndex(items, current);
  if (index === -1) {
    return direction === 1 ? items[0] : items.at(-1);
  }

  return items[(index + direction + items.length) % items.length];
}

/** The item to continue with once the current one is resolved, or undefined when it was the last. */
export function getReviewItemAfter(items: readonly ReviewItem[], current: ReviewItem): ReviewItem | undefined {
  const next = getAdjacentReviewItem(items, current, 1);
  return next && !isSameReviewItem(next, current) ? next : undefined;
}

/** Accepts the boxes as detected. */
export function planConfirm(measures: readonly Measure[]): MeasureEdit {
  const edit = createEmptyEdit();
  measures
    .filter(measure => needsReview(measure.layout))
    .forEach(measure => edit.layouts.set(measure, withoutReview(measure.layout!)));
  edit.boxes = [...measures];
  return edit;
}

/**
 * Turns a box without a number into the layout of measure `value`. Audio songs create the measure
 * when it is missing. MIDI songs only accept measures of their beat map.
 */
export function planNumberBox(
  measures: readonly Measure[],
  box: MeasureLayout,
  value: Numbering,
  mode: MeasureEditMode,
  resolution?: "shift",
): MeasureEditResult {
  const layout = withoutReview(box);
  const options = { count: 1, start: value, beats: getDefaultBeats(measures, layout) };
  const result = planNewBox(measures, layout, options, mode, resolution);
  if (result.status === "ok") {
    result.edit.resolvedBoxes = [box];
  }

  return result;
}

export function planRemoveUnnumberedBox(box: MeasureLayout): MeasureEdit {
  const edit = createEmptyEdit();
  edit.resolvedBoxes = [box];
  return edit;
}
