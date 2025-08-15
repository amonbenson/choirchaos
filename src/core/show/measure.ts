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
  constructor(
    public number: MeasureNumber,
    public beats: number,
    public layout?: MeasureLayout,
  ) {}

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static fromJson({ number, beats, layout }: any) {
    return new Measure(number, beats, layout);
  }
}
