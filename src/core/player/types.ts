import type { MeasureEvent, MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "../midi/events";
import type { VampOut } from "../models/measureEvent";

export type { VampOut };

export type PlayerStatus = "idle" | "loading" | "ready";

export type VampPhase = "entering" | "repeating" | "exiting";

export type PlayerMode = "none" | "midi" | "audio";

export type PlayerVamp = {
  start: number;
  end: number;
  iterations: number;
  out: VampOut;
};

export type PlayerVampState = PlayerVamp & {
  currentIteration: number;
  manualExit: boolean;
};

export type PlayerSegueState = {
  enabled: boolean;
};

export type SystemEvents = {
  measure: MidiEventList<MeasureEvent>;
  tempo: MidiEventList<TempoEvent>;
  timeSignature: MidiEventList<TimeSignatureEvent>;
};

export type TrackEvents = {
  note: MidiEventList<NoteEvent>;
};
