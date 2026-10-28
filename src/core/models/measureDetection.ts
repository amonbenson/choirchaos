import Measure, { createEmptyMeasureEdit, type MeasureAddition, type MeasureLayout } from "./measure";
import { createPlannedEdit, findScoreIndexForBox, type PlannedEdit, sortInReadingOrder } from "./measureEditing";
import { parseLabel } from "./measureLabel";

export type DetectedMeasure = {
  value: string;
  layout: MeasureLayout;
  confidence: number;
};

export type MeasureDetectionOptions = {
  replacePlaced: boolean;
  createMissing: boolean;
  beats: number;
};

export type MeasurePlacement = {
  measure: Measure;
  layout: MeasureLayout;
};

export type MeasureDetectionPlan = {
  placements: MeasurePlacement[];
  /** New measures, with their score index after the plan is applied. */
  additions: MeasureAddition[];
  /** Labels of placed measures whose box stays. */
  keptPlaced: string[];
  /** Boxes whose label is missing, unusable or read twice. They stay on the score without a number. */
  unnumbered: MeasureLayout[];
  /** Labels of placed or added measures whose box carries a review flag. */
  lowConfidence: string[];
};

// The detector's own review threshold: below it, a box or its label is worth checking by hand.
const LOW_CONFIDENCE = 0.5;

const PLANNED_ID = "";

function findByLabel(measures: readonly Measure[], label: string): Measure | undefined {
  const lower = label.toLowerCase();
  return measures.find(measure => measure.label.toLowerCase() === lower);
}

function toLayout({ page, x, y, width, height }: MeasureLayout, review: boolean): MeasureLayout {
  return review ? { page, x, y, width, height, review } : { page, x, y, width, height };
}

function containsCenter(outer: MeasureLayout, inner: MeasureLayout): boolean {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return outer.page === inner.page && x > outer.x && x < outer.x + outer.width && y > outer.y && y < outer.y + outer.height;
}

/**
 * Decides what detected measures do to the measures a song already has. Labels are matched without
 * regard to case because scores print rehearsal letters in either case. The first detection of a
 * label wins, so a label read twice never overwrites its own box. Unsure boxes get a review flag.
 */
export function planMeasureDetection(
  existing: readonly Measure[],
  detected: readonly DetectedMeasure[],
  options: MeasureDetectionOptions,
  existingUnnumbered: readonly MeasureLayout[] = [],
): MeasureDetectionPlan {
  const plan: MeasureDetectionPlan = { placements: [], additions: [], keptPlaced: [], unnumbered: [], lowConfidence: [] };
  const created: Measure[] = [];
  const leftovers: MeasureLayout[] = [];
  const seen = new Set<string>();

  for (const detection of detected) {
    const key = detection.value.toLowerCase();
    if (key && seen.has(key)) {
      leftovers.push(toLayout(detection.layout, false));
      continue;
    }

    seen.add(key);
    if (!planDetection(existing, detection, options, plan, created)) {
      leftovers.push(toLayout(detection.layout, false));
    }
  }

  plan.additions = placeCreated(existing, plan.placements, created);
  plan.unnumbered = leftovers.filter(box => !isCovered(existing, plan, existingUnnumbered, box));
  return plan;
}

/**
 * New measures go into the score at the reading order position of their box, among the boxes the
 * song has once the plan is applied.
 */
function placeCreated(existing: readonly Measure[], placements: readonly MeasurePlacement[], created: readonly Measure[]): MeasureAddition[] {
  const layouts = new Map<Measure, MeasureLayout | undefined>(placements.map(({ measure, layout }) => [measure, layout]));
  const layoutOf = (measure: Measure): MeasureLayout | undefined => layouts.has(measure) ? layouts.get(measure) : measure.layout;
  const score = [...existing];

  for (const measure of sortInReadingOrder(created, candidate => candidate.layout)) {
    score.splice(findScoreIndexForBox(score, measure.layout!, layoutOf), 0, measure);
  }

  return created.map(measure => ({ label: measure.label, beats: measure.beats, layout: measure.layout, index: score.indexOf(measure) }));
}

/**
 * A leftover box on top of a box that is already there would only be clutter, which happens when a
 * score is detected a second time.
 */
function isCovered(existing: readonly Measure[], plan: MeasureDetectionPlan, existingUnnumbered: readonly MeasureLayout[], box: MeasureLayout): boolean {
  const replaced = new Set(plan.placements.map(placement => placement.measure));
  const kept = existing.filter(measure => measure.layout && !replaced.has(measure)).map(measure => measure.layout!);
  const placed = [...plan.placements.map(placement => placement.layout), ...plan.additions.map(addition => addition.layout!)];
  return [...kept, ...placed, ...existingUnnumbered].some(other => containsCenter(other, box));
}

/** Returns whether the detection found a measure to place or keep, so its box is accounted for. */
function planDetection(
  existing: readonly Measure[],
  detection: DetectedMeasure,
  options: MeasureDetectionOptions,
  plan: MeasureDetectionPlan,
  created: Measure[],
): boolean {
  const unsure = detection.confidence < LOW_CONFIDENCE;
  const measure = findByLabel(existing, detection.value);
  if (measure) {
    if (measure.layout && !options.replacePlaced) {
      plan.keptPlaced.push(measure.label);
      return true;
    }

    plan.placements.push({ measure, layout: toLayout(detection.layout, unsure) });
    if (unsure) {
      plan.lowConfidence.push(measure.label);
    }

    return true;
  }

  // Detected text that is no measure number is more likely a misread than a new measure.
  if (!options.createMissing || !parseLabel(detection.value)) {
    return false;
  }

  created.push(new Measure(PLANNED_ID, detection.value, options.beats, toLayout(detection.layout, unsure)));
  if (unsure) {
    plan.lowConfidence.push(detection.value);
  }

  return true;
}

export function hasMeasureDetectionChanges(plan: MeasureDetectionPlan): boolean {
  return plan.placements.length > 0 || plan.additions.length > 0 || plan.unnumbered.length > 0;
}

/** The plan as one measure edit. Applied leftovers join the boxes without a number. */
export function toMeasureEdit(plan: MeasureDetectionPlan, existingUnnumbered: readonly MeasureLayout[]): PlannedEdit {
  const edit = createEmptyMeasureEdit();
  plan.placements.forEach(({ measure, layout }) => edit.layouts.set(measure.id, layout));
  edit.additions = plan.additions.map(addition => ({ ...addition }));
  if (plan.unnumbered.length > 0) {
    edit.unnumberedBoxes = [...existingUnnumbered, ...plan.unnumbered];
  }

  return createPlannedEdit(edit);
}
