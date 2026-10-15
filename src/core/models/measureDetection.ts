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
  duplicates: string[];
  unmatched: string[];
  lowConfidence: Numbering[];
};

// The detector's own review threshold: below it, a box or its label is worth checking by hand.
const LOW_CONFIDENCE = 0.5;

function findByValue(measures: Measure[], value: string): Measure | undefined {
  const lower = value.toLowerCase();
  return measures.find(measure => measure.value.toLowerCase() === lower);
}

/**
 * Decides what detected measures do to the measures a song already has. Labels are matched without
 * regard to case because scores print rehearsal letters in either case. The first detection of a
 * label wins, so a label read twice never overwrites its own box.
 */
export function planMeasureDetection(
  existing: Measure[],
  detected: DetectedMeasure[],
  options: MeasureDetectionOptions,
): MeasureDetectionPlan {
  const plan: MeasureDetectionPlan = { placements: [], additions: [], keptPlaced: [], duplicates: [], unmatched: [], lowConfidence: [] };
  const seen = new Set<string>();

  for (const detection of detected) {
    const key = detection.value.toLowerCase();
    if (key && seen.has(key)) {
      plan.duplicates.push(detection.value);
      continue;
    }

    seen.add(key);
    const value = planDetection(existing, detection, options, plan);
    if (value !== undefined && detection.confidence < LOW_CONFIDENCE) {
      plan.lowConfidence.push(value);
    }
  }

  return plan;
}

function planDetection(
  existing: Measure[],
  detection: DetectedMeasure,
  options: MeasureDetectionOptions,
  plan: MeasureDetectionPlan,
): Numbering | undefined {
  const measure = findByValue(existing, detection.value);
  if (measure) {
    if (measure.layout && !options.replacePlaced) {
      plan.keptPlaced.push(measure.value);
      return undefined;
    }

    plan.placements.push({ measure, layout: detection.layout });
    return measure.value;
  }

  if (!options.createMissing || !isNumbering(detection.value)) {
    plan.unmatched.push(detection.value);
    return undefined;
  }

  plan.additions.push(new Measure(detection.value, options.beats, detection.layout));
  return detection.value;
}

export function hasMeasureDetectionChanges(plan: MeasureDetectionPlan): boolean {
  return plan.placements.length > 0 || plan.additions.length > 0;
}
