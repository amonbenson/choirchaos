import type { TrackEvents } from "../player/types";

export type TrackClassification = "Accompaniment" | "Percussion" | "Vocal";

export default class Track {
  constructor(
    public readonly title: string,
    public readonly classification: TrackClassification = "Accompaniment",
    public readonly program: number = 0,
    public readonly audioFile: string = "",
    public mixer: {
      index: number;
      mute: boolean;
      solo: boolean;
      highlight: boolean;
      gain: number;
      effectiveMute: boolean;
      effectiveGain: number;
    } = {
      index: 0,
      mute: false,
      solo: false,
      highlight: false,
      gain: 1.0,
      effectiveMute: false,
      effectiveGain: 1.0,
    },
    public $midiTrackEvents: TrackEvents | object = {},
  ) {}

  public serialize(): any {
    return {
      title: this.title,
      classification: this.classification,
      program: this.program,
      audioFile: this.audioFile,
    };
  }

  public static deserialize({ title, classification, program, audioFile }: any): Track {
    return new Track(title, classification, program, audioFile);
  }
}
