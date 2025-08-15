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
  public number: MeasureNumber;
  public beats: number;
  public layout?: MeasureLayout;

  constructor(value: Numbering, beats: number) {
    this.number = value;
    this.beats = beats;
  }

  public reference(beat: BeatNumber): MeasureReference {
    return [this.number, beat];
  }

  public json() {
    return {
      value: this.number,
      beats: this.beats,
      layout: this.layout,
    };
  }
}
