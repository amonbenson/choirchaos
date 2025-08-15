import type { MeasureReference } from "./measure";

export class MeasureEvent {
  public $tick?: number;

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
}
