import type { MeasureEvent, MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "../midi/events";
import type { MeasureId } from "../models/measure";
import type { SectionKind, VampOut, VampVocals } from "../models/sections";

export type { VampOut, VampVocals };

export type PlayerStatus = "idle" | "loading" | "ready";

export type VampPhase = "entering" | "repeating" | "exiting";

export type PlayerMode = "none" | "midi" | "audio";

/** A beat at a timeline position, together with the measure occurrence it plays. */
export type PlayerLocation = { position: number; measure: MeasureId; occurrence: number; beat: number };

export type PlayerSectionState = {
  /** Index into `song.getSections()`. */
  section: number;
  kind: SectionKind;
  /** The 1-based pass being played. */
  pass: number;
  /** Total passes, undefined while a vamp runs until released. */
  passes?: number;
  recordedPasses: number;
  released: boolean;
};

export type PlayerVamp = {
  start: number;
  end: number;
  iterations: number;
  out: VampOut;
  vocals: VampVocals;
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
