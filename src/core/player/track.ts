import MidiTrack from "./midiTrack";

export type TrackClassification = "accompaniment" | "percussion" | "vocal";

export default class Track {
  public title: string = "";
  public classification: string = "accompaniment";
  public program: number = 0;
  public $midi?: MidiTrack;

  public json() {
    return {
      title: this.title,
      classification: this.classification,
      program: this.program,
    };
  }
}
