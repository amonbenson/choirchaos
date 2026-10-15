import type { PartSpec, ScoreSpec } from "./types";

const SOLO: PartSpec = {
  id: "solo",
  name: "Solo",
  abbreviation: "Solo",
  classification: "Vocal",
  program: 52,
  clefs: ["treble"],
  range: [62, 76],
  syllables: ["la", "da", "doo", "ah"],
};

const CHOIR_UPPER: PartSpec = {
  id: "choirUpper",
  name: "Choir S/A",
  abbreviation: "S/A",
  classification: "Vocal",
  program: 52,
  clefs: ["treble"],
  range: [60, 74],
  syllables: ["oo", "ah"],
};

const CHOIR_LOWER: PartSpec = {
  id: "choirLower",
  name: "Choir T/B",
  abbreviation: "T/B",
  classification: "Vocal",
  program: 52,
  clefs: ["bass"],
  range: [45, 62],
  syllables: ["oo", "ah"],
};

const PIANO: PartSpec = {
  id: "piano",
  name: "Piano",
  abbreviation: "Pno.",
  classification: "Accompaniment",
  program: 0,
  clefs: ["treble", "bass"],
  range: [36, 79],
};

/** Four bars, one system, solo and piano. The cheapest fixture for tests that just need a song. */
export const MINIMAL: ScoreSpec = {
  id: "minimal",
  title: "Minimal Test Song",
  number: "1",
  seed: 1,
  keyFifths: 0,
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 120,
  parts: [SOLO, PIANO],
  sections: [{ measures: 4 }],
  measuresPerSystem: 4,
};

/**
 * A multi-page piano/conductor score: solo, two choir staves and piano, with a pickup, rehearsal
 * marks, tacet choir, inserted bars ("12a"), a tempo and metre change and an open vamp.
 */
export const CONDUCTOR: ScoreSpec = {
  id: "conductor",
  title: "Conductor Test Song",
  number: "3",
  seed: 3,
  keyFifths: 2,
  timeSignature: { beats: 4, beatType: 4 },
  tempo: 112,
  pickupBeats: 1,
  parts: [SOLO, CHOIR_UPPER, CHOIR_LOWER, PIANO],
  sections: [
    { measures: 8, rehearsalMark: "A", tacet: ["choirUpper", "choirLower"] },
    { measures: 4, rehearsalMark: "B" },
    { measures: 2, inserted: true },
    { measures: 6, rehearsalMark: "C", timeSignature: { beats: 3, beatType: 4 }, tempo: 92, tempoText: "Meno mosso", tacet: ["solo"] },
    { measures: 2, rehearsalMark: "D", timeSignature: { beats: 4, beatType: 4 }, tempo: 112, tempoText: "A tempo", vamp: { iterations: 0 }, tacet: ["solo", "choirUpper", "choirLower"] },
    { measures: 8, rehearsalMark: "E" },
  ],
  measuresPerSystem: 4,
  systemsPerPage: 3,
};

/** Compound and short metres in a flat key, for beat and tick mapping edge cases. */
export const COMPOUND_METER: ScoreSpec = {
  id: "compound-meter",
  title: "Compound Meter Test Song",
  number: "7",
  seed: 7,
  keyFifths: -3,
  timeSignature: { beats: 6, beatType: 8 },
  tempo: 132,
  parts: [CHOIR_UPPER, CHOIR_LOWER, PIANO],
  sections: [
    { measures: 4, rehearsalMark: "A" },
    { measures: 2, rehearsalMark: "B", timeSignature: { beats: 2, beatType: 4 }, tempo: 100 },
    { measures: 3, rehearsalMark: "C", timeSignature: { beats: 6, beatType: 8 }, tempo: 132, vamp: { iterations: 2 } },
  ],
  measuresPerSystem: 3,
};

export const SCORE_PRESETS: readonly ScoreSpec[] = [MINIMAL, CONDUCTOR, COMPOUND_METER];

export function findScorePreset(id: string): ScoreSpec {
  const spec = SCORE_PRESETS.find(preset => preset.id === id);
  if (!spec) {
    throw new Error(`Unknown score preset '${id}'. Known presets: ${SCORE_PRESETS.map(p => p.id).join(", ")}.`);
  }

  return spec;
}
