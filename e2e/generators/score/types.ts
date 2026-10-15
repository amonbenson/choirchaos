export type TimeSignature = {
  beats: number;
  beatType: 4 | 8;
};

export type Clef = "treble" | "treble8vb" | "bass";

export type TrackClassification = "Accompaniment" | "Percussion" | "Vocal";

export type PartSpec = {
  id: string;
  /** Also used as MIDI track name and song track title, which the player matches by name. */
  name: string;
  abbreviation: string;
  classification: TrackClassification;
  /** General MIDI program, 0-based. */
  program: number;
  /** One clef per staff. Two clefs produce a grand staff, as used for the piano reduction. */
  clefs: Clef[];
  /** Lowest and highest MIDI pitch the part may use. */
  range: [number, number];
  /** Neutral syllables cycled under the notes. Vocal parts only. */
  syllables?: string[];
};

export type VampSpec = {
  /** 0 repeats until the conductor leaves the vamp. */
  iterations: number;
};

export type SectionSpec = {
  measures: number;
  timeSignature?: TimeSignature;
  tempo?: number;
  tempoText?: string;
  rehearsalMark?: string;
  /** Part ids that rest throughout the section. Hidden on systems where every bar is empty. */
  tacet?: string[];
  /** Numbered after the previous bar with letter suffixes ("12a", "12b"), like inserted bars in a revised score. */
  inserted?: boolean;
  vamp?: VampSpec;
};

export type ScoreSpec = {
  id: string;
  title: string;
  /** Song number within the show, e.g. "3" or "12a". */
  number: string;
  seed: number;
  /** Circle-of-fifths position of the major key. Negative values are flats. */
  keyFifths: number;
  timeSignature: TimeSignature;
  tempo: number;
  /** Length of the pickup bar in beats. The pickup is numbered "0". */
  pickupBeats?: number;
  parts: PartSpec[];
  sections: SectionSpec[];
  /** Forces a system break after this many bars, which makes measure positions predictable. */
  measuresPerSystem: number;
  /** Forces a page break after this many systems. MuseScore decides when omitted. */
  systemsPerPage?: number;
};
