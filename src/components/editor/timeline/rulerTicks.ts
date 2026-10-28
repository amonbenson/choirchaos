/** A tick of a timeline ruler. Ticks without a label are drawn short. */
export type RulerTick = {
  key: number;
  x: number;
  label?: string;
  /** Raised after the label, such as the occurrence of a repeated measure. */
  superscript?: string;
  /** Tailwind text color class of the label, instead of the muted one. */
  color?: string;
};

/** Seconds between labelled ticks of the time ruler, so labels land on round times. */
export const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Measures between labelled ticks of the measure ruler, in phrases of 2, 4, 8 ... measures. */
export const MEASURE_STEPS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

const SECONDS_PER_MINUTE = 60;

/** The smallest step that keeps labelled ticks at least minSpacing pixels apart. */
export function pickRulerStep(steps: readonly number[], pixelsPerUnit: number, minSpacing: number): number {
  return steps.find(step => step * pixelsPerUnit >= minSpacing) ?? steps[steps.length - 1]!;
}

/** The multiples of step from start to end, both included. */
export function getMultiplesBetween(start: number, end: number, step: number): number[] {
  const multiples: number[] = [];
  for (let value = Math.ceil(start / step) * step; value <= end; value += step) {
    multiples.push(value);
  }

  return multiples;
}

/** "1:05", whole minutes and seconds. */
export function formatRulerTime(seconds: number): string {
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
  const rest = Math.round(seconds - minutes * SECONDS_PER_MINUTE);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function getMedian(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
