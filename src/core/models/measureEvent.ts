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

  public serialize(): any {
    return {
      type: "marker",
      start: this.start,
      marker: this.marker,
    };
  }

  public static deserialize({ start, marker }: any): MarkerEvent {
    return new MarkerEvent(start, marker);
  }
}

export class VampEvent extends MeasureEvent {
  constructor(public start: MeasureReference, public end: MeasureReference, public iterations: number) {
    super(start, end);
  }

  public serialize(): any {
    return {
      type: "vamp",
      start: this.start,
      end: this.end,
      iterations: this.iterations,
    };
  }

  public static deserialize({ start, end, iterations }: any): VampEvent {
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
