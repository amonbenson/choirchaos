import { BinarySortedList } from "../utils/binarySearch";
import { compareMeasureReferences, type MeasureReference } from "./measure";

export class MeasureEvent {
  public $startTick?: number;
  public $endTick?: number;

  constructor(public start: MeasureReference, public end: MeasureReference = start) {}
}

// export class SectionEvent extends MeasureEvent {
//   public section: string = "";
// }

export class MarkerEvent extends MeasureEvent {
  constructor(public start: MeasureReference, public marker: string) {
    super(start);
  }

  public json() {
    return {
      type: "marker",
      start: this.start,
    };
  }


  public static fromJson({ start, marker }: any) {
    return new MarkerEvent(start, marker);
  }
}

export class VampEvent extends MeasureEvent {
  constructor(public start: MeasureReference, public end: MeasureReference, public iterations: number) {
    super(start, end);
  }

  public json() {
    return {
      type: "vamp",
      start: this.start,
      end: this.end,
      iterations: this.iterations,
    };
  }


  public static fromJson({ start, end, iterations }: any) {
    return new VampEvent(start, end, iterations);
  }
}

export class MeasureEventList<T extends MeasureEvent> extends BinarySortedList<T> {
  constructor(items?: T[]) {
    super(items, {
      comparator: (a, b) => compareMeasureReferences(a.start, b.start),
    });
  }
}
