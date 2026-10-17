import { isNumbering, type Numbering } from "../utils/numbering";
import Measure, { type MeasureLayout } from "./measure";

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
  additions: Measure[];
  keptPlaced: Numbering[];
  /** Boxes whose label is missing, unusable or read twice. They stay on the score without a number. */
  unnumbered: MeasureLayout[];
  /** Placed or added measures whose box carries a review flag. */
  lowConfidence: Numbering[];
};

// The detector's own review threshold: below it, a box or its label is worth checking by hand.
const LOW_CONFIDENCE = 0.5;

function findByValue(measures: Measure[], value: string): Measure | undefined {
  const lower = value.toLowerCase();
  return measures.find(measure => measure.value.toLowerCase() === lower);
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
  existing: Measure[],
  detected: DetectedMeasure[],
  options: MeasureDetectionOptions,
  existingUnnumbered: readonly MeasureLayout[] = [],
): MeasureDetectionPlan {
  const plan: MeasureDetectionPlan = { placements: [], additions: [], keptPlaced: [], unnumbered: [], lowConfidence: [] };
  const leftovers: MeasureLayout[] = [];
  const seen = new Set<string>();

  for (const detection of detected) {
    const key = detection.value.toLowerCase();
    if (key && seen.has(key)) {
      leftovers.push(toLayout(detection.layout, false));
      continue;
    }

    seen.add(key);
    if (!planDetection(existing, detection, options, plan)) {
      leftovers.push(toLayout(detection.layout, false));
    }
  }

  plan.unnumbered = leftovers.filter(box => !isCovered(existing, plan, existingUnnumbered, box));
  return plan;
}

/**
 * A leftover box on top of a box that is already there would only be clutter, which happens when a
 * score is detected a second time.
 */
function isCovered(existing: Measure[], plan: MeasureDetectionPlan, existingUnnumbered: readonly MeasureLayout[], box: MeasureLayout): boolean {
  const replaced = new Set(plan.placements.map(placement => placement.measure));
  const kept = existing.filter(measure => measure.layout && !replaced.has(measure)).map(measure => measure.layout!);
  const placed = [...plan.placements.map(placement => placement.layout), ...plan.additions.map(measure => measure.layout!)];
  return [...kept, ...placed, ...existingUnnumbered].some(other => containsCenter(other, box));
}

/** Returns whether the detection found a measure to place or keep, so its box is accounted for. */
function planDetection(
  existing: Measure[],
  detection: DetectedMeasure,
  options: MeasureDetectionOptions,
  plan: MeasureDetectionPlan,
): boolean {
  const unsure = detection.confidence < LOW_CONFIDENCE;
  const measure = findByValue(existing, detection.value);
  if (measure) {
    if (measure.layout && !options.replacePlaced) {
      plan.keptPlaced.push(measure.value);
      return true;
    }

    plan.placements.push({ measure, layout: toLayout(detection.layout, unsure) });
    if (unsure) {
      plan.lowConfidence.push(measure.value);
    }

    return true;
  }

  if (!options.createMissing || !isNumbering(detection.value)) {
    return false;
  }

  plan.additions.push(new Measure(detection.value, options.beats, toLayout(detection.layout, unsure)));
  if (unsure) {
    plan.lowConfidence.push(detection.value);
  }

  return true;
}

export function hasMeasureDetectionChanges(plan: MeasureDetectionPlan): boolean {
  return plan.placements.length > 0 || plan.additions.length > 0 || plan.unnumbered.length > 0;
}
