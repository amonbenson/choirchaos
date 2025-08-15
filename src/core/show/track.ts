import MidiTrack from "./midiTrack";

export type TrackClassification = "accompaniment" | "percussion" | "vocal";

export default class Track {
  constructor(
    public title: string,
    public classification: string = "accompaniment",
    public program: number = 0,
    public $midi?: MidiTrack,
  ) {}

  public json() {
    return {
      title: this.title,
      classification: this.classification,
      program: this.program,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public static fromJson({ title, classification, program }: any) {
    return new Track(title, classification, program);
  }
}
