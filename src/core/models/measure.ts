import { BinarySortedList } from "../utils/binarySearch";
import { compareNumberings, type Numbering } from "../utils/numbering";

export type MeasureLayout = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MeasureNumber = Numbering;
export type BeatNumber = number;
export type MeasureReference = [MeasureNumber, BeatNumber];

export function compareMeasureReferences(a: MeasureReference, b: MeasureReference): number {
  const nrDiff = compareNumberings(a[0], b[0]);
  if (nrDiff !== 0) {
    // compare by measure numbers
    return nrDiff;
  } else {
    // compare by beats
    return a[1] - b[1];
  }
}

export default class Measure {
  constructor(
    public value: MeasureNumber,
    public beats: number,
    public layout?: MeasureLayout,
    public $beatTicks: number[] = [],
    public $tickLength?: number,
    public $activeTrackIndices: Set<number> = new Set(),
  ) {}

  public reference(beat: BeatNumber): MeasureReference {
    return [this.value, beat];
  }

  public json(): any {
    return {
      value: this.value,
      beats: this.beats,
      layout: this.layout,
    };
  }

  public static fromJson({ value, beats, layout }: any): Measure {
    return new Measure(value, beats, layout);
  }
}

export function compareMeasures(a: Measure, b: Measure): number {
  return compareNumberings(a.value, b.value);
}

export class MeasureList extends BinarySortedList<Measure> {
  constructor(items?: Measure[]) {
    super(items, {
      comparator: (a, b) => compareMeasures(a, b),
    });
  }
}
