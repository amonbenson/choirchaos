import type { MidiTrackEvents } from "./midiPlayer";

export type TrackClassification = "Accompaniment" | "Percussion" | "Vocal";

export default class Track {
  constructor(
    public title: string,
    public classification: string = "Accompaniment",
    public program: number = 0,
    public $midiTrackEvents: MidiTrackEvents | object = {},
  ) {}

  public json() {
    return {
      title: this.title,
      classification: this.classification,
      program: this.program,
    };
  }


  public static fromJson({ title, classification, program }: any) {
    return new Track(title, classification, program);
  }
}
