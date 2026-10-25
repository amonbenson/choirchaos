import { BinarySortedList } from "../utils/binarySearch";
import type { Tick, TimeSignature } from "./types";

export class MidiEvent {
  constructor(public tick: Tick) {}
}

export class NoteEvent extends MidiEvent {
  constructor(public tick: Tick, public duration: Tick, public pitch: number, public velocity: number, public trackIndex: number) {
    super(tick);
  }
}

/** A 0-based beat of the timeline position that plays at `tick`. */
export class BeatEvent extends MidiEvent {
  constructor(public tick: Tick, public position: number, public beat: number) {
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
