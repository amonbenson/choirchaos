import type { MeasureReference } from "./measure";

export class MeasureEvent {
  public $tick?: number;

  constructor(public start: MeasureReference, public end?: MeasureReference) {}
}

// export class SectionEvent extends MeasureEvent {
//   public section: string = "";
// }

export class MarkerEvent extends MeasureEvent {
  constructor(public start: MeasureReference, public marker: string) {
    super(start);
  }
}

export class VampEvent extends MeasureEvent {
  constructor(public start: MeasureReference, public end: MeasureReference) {
    super(start, end);
  }
}
