import type { Numbering } from "../utils/numbering";

export type MeasureLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MeasureNumber = Numbering;
export type BeatNumber = number;
export type MeasureReference = [MeasureNumber, BeatNumber];

export default class Measure {
  public value: MeasureNumber;
  public beatTicks: number[] = [];
  public layout?: MeasureLayout;

  constructor(value: Numbering, beatTicks: number[]) {
    this.value = value;
    this.beatTicks = beatTicks;
  }

  public reference(beat: BeatNumber): MeasureReference {
    return [this.value, beat];
  }
}
