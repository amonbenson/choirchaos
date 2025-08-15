import type { NoteEvent, TempoEvent, TimeSignatureEvent } from "./midiEvents";

export type MidiTrackEvents = {
  notes: NoteEvent[],
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[],
}

export default class MidiTrack {
  public events: MidiTrackEvents = {
    notes: [],
    tempos: [],
    timeSignatures: [],
  };
  public program: number = 0;
}
