import { BinarySortedList } from "../utils/binarySearch";
import type { MeasureReference } from "../models/measure";
import type { Tick, TimeSignature } from "./types";

export class MidiEvent {
  constructor(public tick: Tick) {}
}

export class NoteEvent extends MidiEvent {
  constructor(public tick: Tick, public duration: Tick, public pitch: number, public velocity: number, public trackIndex: number) {
    super(tick);
  }
}

export class MeasureEvent extends MidiEvent {
  constructor(public tick: Tick, public measure: MeasureReference) {
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

export class MidiEventList<T extends MidiEvent> extends BinarySortedList<T> {
  constructor(items?: T[]) {
    super(items, {
      comparator: (a, b) => a.tick - b.tick,
    });
  }
}
