export type NoteValue = "quarter" | "dottedQuarter" | "half" | "dottedHalf";

/** The beat a conductor would give: its written note value and tempo, and how many of the bar's beats it spans. */
export type Pulse = { noteValue: NoteValue; bpm: number; beatsPerPulse: number };

export const NOTE_VALUE_QUARTERS: Record<NoteValue, number> = {
  quarter: 1,
  dottedQuarter: 1.5,
  half: 2,
  dottedHalf: 3,
};

const NOTE_VALUES = Object.keys(NOTE_VALUE_QUARTERS) as NoteValue[];

/** Above this a pulse is too fast to conduct, so a longer one is chosen. */
const MAX_PULSE_BPM = 170;

/** Bars of 6, 9 or 12 beats are counted in groups of three. */
export function isCompound(beats: number): boolean {
  return beats > 3 && beats % 3 === 0;
}

/** A bar without a time signature (audio songs) is guessed: compound bars count eighths, all others quarters. */
export function guessBeatQuarters(beats: number): number {
  return isCompound(beats) ? 0.5 : 1;
}

/**
 * The pulse of a bar of `beats` beats, each `beatQuarters` quarter notes long and played at `beatBpm`. It is the
 * shortest note value that groups whole beats, divides the bar and, in compound bars, groups them in threes, unless
 * it is faster than a conductor would beat. A 4/4 bar at 210 is beaten in halves, a 6/8 bar in dotted quarters.
 */
export function getPulse(beatBpm: number, beats: number, beatQuarters = guessBeatQuarters(beats)): Pulse {
  const candidates = getCandidates(beats, beatQuarters);
  const pulses = candidates.map(({ noteValue, beatsPerPulse }) => ({ noteValue, beatsPerPulse, bpm: beatBpm / beatsPerPulse }));
  return pulses.find(pulse => pulse.bpm < MAX_PULSE_BPM) ?? pulses.at(-1)!;
}

function getCandidates(beats: number, beatQuarters: number): Omit<Pulse, "bpm">[] {
  const fitting = NOTE_VALUES
    .map(noteValue => ({ noteValue, beatsPerPulse: NOTE_VALUE_QUARTERS[noteValue] / beatQuarters }))
    .filter(({ beatsPerPulse }) => Number.isInteger(beatsPerPulse) && beats % beatsPerPulse === 0)
    .filter(({ beatsPerPulse }) => !isCompound(beats) || beatsPerPulse % 3 === 0);

  return fitting.length > 0 ? fitting : [{ noteValue: "quarter", beatsPerPulse: Math.max(1, Math.round(1 / beatQuarters)) }];
}
