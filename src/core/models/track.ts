import type { MidiTrackEvents } from "../midi/player";

export type TrackClassification = "Accompaniment" | "Percussion" | "Vocal";

export type TrackPatch = Partial<{
  title: string;
  classification: TrackClassification;
  program: number;
  audioFile: string;
}>;

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
    public $midiTrackEvents: MidiTrackEvents | object = {},
  ) {}

  public _applyPatch(patch: TrackPatch): void {
    if (patch.title !== undefined) {
      (this as any).title = patch.title;
    }

    if (patch.classification !== undefined) {
      (this as any).classification = patch.classification;
    }

    if (patch.program !== undefined) {
      (this as any).program = Math.max(0, Math.min(127, patch.program));
    }

    if (patch.audioFile !== undefined) {
      (this as any).audioFile = patch.audioFile;
    }
  }

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
