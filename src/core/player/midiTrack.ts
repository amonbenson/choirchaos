import type { NoteEvent, TempoEvent, TimeSignatureEvent } from "./midiEvents";

export type MidiTrackEvents = {
  notes: NoteEvent[],
  tempos: TempoEvent[],
  timeSignatures: TimeSignatureEvent[],
}

export class MidiTrack {
  public events: MidiTrackEvents = {
    notes: [],
    tempos: [],
    timeSignatures: [],
  };
}
