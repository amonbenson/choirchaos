import type { Tick, TimeSignature } from "./midiTypes";

export class MidiEvent {
  constructor(public tick: Tick) {}
}

export class NoteEvent extends MidiEvent {
  constructor(public tick: Tick, public duration: Tick, public note: number, public velocity: number) {
    super(tick);
  }
}

export class TempoEvent extends MidiEvent {
  constructor(public tick: Tick, public bpm: number) {
    super(tick);
  }
}

export class TimeSignatureEvent extends MidiEvent {
  constructor(public tick: Tick, public signature: TimeSignature) {
    super(tick);
  }
}
