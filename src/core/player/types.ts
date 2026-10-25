import type { BeatEvent, MidiEventList, NoteEvent, TempoEvent, TimeSignatureEvent } from "../midi/events";
import type { MeasureId } from "../models/measure";
import type { SectionKind, VampOut, VampVocals } from "../models/sections";

export type { VampOut, VampVocals };

export type PlayerStatus = "idle" | "loading" | "ready";

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

export type PlayerSegueState = {
  enabled: boolean;
};

export type SystemEvents = {
  /** One event per beat of every timeline position, in tick order. */
  beat: MidiEventList<BeatEvent>;
  tempo: MidiEventList<TempoEvent>;
  timeSignature: MidiEventList<TimeSignatureEvent>;
};

export type TrackEvents = {
  note: MidiEventList<NoteEvent>;
};
