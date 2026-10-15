import { createRandom, type Random } from "../random";
import type { PartSpec, ScoreSpec, TimeSignature, VampSpec } from "./types";

export const PPQN = 480;
/** Eighth notes. Every generated duration is a whole number of eighths. */
export const UNITS_PER_QUARTER = 2;
export const TICKS_PER_UNIT = PPQN / UNITS_PER_QUARTER;

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const PROGRESSION_DEGREES = [0, 1, 3, 4, 5];
const TONIC = 0;
const DOMINANT = 4;
const GRAND_STAFF_SPLIT_PITCH = 60;
const VOCAL_VELOCITY = 84;
const ACCOMPANIMENT_VELOCITY = 70;
/** Durations that have a single, tie-free note value. */
export const NOTATABLE_UNITS = [1, 2, 3, 4, 6, 8];

export type TimelineMeasure = {
  index: number;
  number: string;
  sectionIndex: number;
  startTick: number;
  lengthUnits: number;
  beats: number;
  ticksPerBeat: number;
  timeSignature: TimeSignature;
  showTimeSignature: boolean;
  tempo: number;
  tempoChange: number | undefined;
  tempoText: string | undefined;
  rehearsalMark: string | undefined;
  isPickup: boolean;
  isInserted: boolean;
  vampStart: VampSpec | undefined;
  vampEnd: VampSpec | undefined;
  systemBreak: boolean;
  pageBreak: boolean;
  isLast: boolean;
  chordRootDegree: number;
};

/** A note, chord or rest. `pitches` is empty for rests. */
export type TimelineEvent = {
  partId: string;
  staff: number;
  measureIndex: number;
  offsetUnits: number;
  durationUnits: number;
  pitches: number[];
  isMeasureRest: boolean;
  velocity: number;
  lyric: string | undefined;
};

export type TempoChange = { tick: number; bpm: number };

export type Timeline = {
  spec: ScoreSpec;
  measures: TimelineMeasure[];
  events: TimelineEvent[];
  tempoChanges: TempoChange[];
  durationTicks: number;
};

export function unitsPerBeat(timeSignature: TimeSignature): number {
  return (UNITS_PER_QUARTER * 4) / timeSignature.beatType;
}

export function eventStartTick(timeline: Timeline, event: TimelineEvent): number {
  return timeline.measures[event.measureIndex]!.startTick + event.offsetUnits * TICKS_PER_UNIT;
}

export function tickToSeconds(timeline: Timeline, tick: number): number {
  let seconds = 0;
  let previous = timeline.tempoChanges[0]!;

  for (const change of timeline.tempoChanges.slice(1)) {
    if (change.tick >= tick) {
      break;
    }

    seconds += ticksToSeconds(change.tick - previous.tick, previous.bpm);
    previous = change;
  }

  return seconds + ticksToSeconds(tick - previous.tick, previous.bpm);
}

function ticksToSeconds(ticks: number, bpm: number): number {
  return (ticks / PPQN) * (60 / bpm);
}

export function durationSeconds(timeline: Timeline): number {
  return tickToSeconds(timeline, timeline.durationTicks);
}

function nextSuffix(previousNumber: string): string {
  const match = /^(\d+)([a-z]?)$/.exec(previousNumber);
  if (!match) {
    throw new Error(`Cannot derive an inserted bar number from '${previousNumber}'.`);
  }

  const [, digits, suffix] = match;
  const nextLetter = suffix ? String.fromCharCode(suffix.charCodeAt(0) + 1) : "a";
  return `${digits}${nextLetter}`;
}

function pickChordDegree(random: Random, isFirst: boolean, isLast: boolean, isPickup: boolean): number {
  if (isPickup) {
    return DOMINANT;
  }

  if (isFirst || isLast) {
    return TONIC;
  }

  return random.pick(PROGRESSION_DEGREES);
}

function buildMeasures(spec: ScoreSpec, random: Random): TimelineMeasure[] {
  const measures: TimelineMeasure[] = [];
  const totalMeasures = (spec.pickupBeats ? 1 : 0) + spec.sections.reduce((sum, s) => sum + s.measures, 0);

  let tick = 0;
  let timeSignature = spec.timeSignature;
  let tempo = spec.tempo;
  let regularNumber = 0;
  let previousNumber = "0";

  const pushMeasure = (fields: Pick<TimelineMeasure, "number" | "sectionIndex" | "isPickup" | "isInserted"> & Partial<TimelineMeasure>): void => {
    const index = measures.length;
    const beatUnits = unitsPerBeat(timeSignature);
    const beats = fields.isPickup ? spec.pickupBeats! : timeSignature.beats;
    const systemIndex = Math.floor(index / spec.measuresPerSystem);
    const startsSystem = index > 0 && index % spec.measuresPerSystem === 0;
    const isLast = index === totalMeasures - 1;

    const measure: TimelineMeasure = {
      index,
      startTick: tick,
      lengthUnits: beats * beatUnits,
      beats,
      ticksPerBeat: beatUnits * TICKS_PER_UNIT,
      timeSignature,
      showTimeSignature: index === 0,
      tempo,
      tempoChange: undefined,
      tempoText: undefined,
      rehearsalMark: undefined,
      vampStart: undefined,
      vampEnd: undefined,
      systemBreak: startsSystem,
      pageBreak: startsSystem && spec.systemsPerPage !== undefined && systemIndex % spec.systemsPerPage === 0,
      isLast,
      chordRootDegree: pickChordDegree(random, index === 0 || (index === 1 && !!spec.pickupBeats), isLast, fields.isPickup),
      ...fields,
    };

    measures.push(measure);
    tick += measure.lengthUnits * TICKS_PER_UNIT;
    previousNumber = measure.number;
  };

  if (spec.pickupBeats) {
    pushMeasure({ number: "0", sectionIndex: 0, isPickup: true, isInserted: false, tempoChange: tempo });
  }

  spec.sections.forEach((section, sectionIndex) => {
    const timeSignatureChanged = section.timeSignature !== undefined
      && (section.timeSignature.beats !== timeSignature.beats || section.timeSignature.beatType !== timeSignature.beatType);
    timeSignature = section.timeSignature ?? timeSignature;
    tempo = section.tempo ?? tempo;

    for (let i = 0; i < section.measures; i++) {
      const isSectionStart = i === 0;
      const isSectionEnd = i === section.measures - 1;
      const isScoreStart = measures.length === 0;

      if (!section.inserted) {
        regularNumber++;
      }

      pushMeasure({
        number: section.inserted ? nextSuffix(previousNumber) : String(regularNumber),
        sectionIndex,
        isPickup: false,
        isInserted: !!section.inserted,
        ...(isSectionStart && (timeSignatureChanged || isScoreStart) ? { showTimeSignature: true } : {}),
        ...(isSectionStart && (section.tempo !== undefined || isScoreStart) ? { tempoChange: tempo } : {}),
        ...(isSectionStart ? { tempoText: section.tempoText, rehearsalMark: section.rehearsalMark } : {}),
        ...(isSectionStart && section.vamp ? { vampStart: section.vamp } : {}),
        ...(isSectionEnd && section.vamp ? { vampEnd: section.vamp } : {}),
      });
    }
  });

  return measures;
}

function chordPitchClasses(keyFifths: number, degree: number): number[] {
  const tonicPitchClass = (((keyFifths * 7) % 12) + 12) % 12;
  return [0, 2, 4].map(step => (tonicPitchClass + MAJOR_SCALE[(degree + step) % 7]!) % 12);
}

function pitchesInRange(pitchClasses: number[], [low, high]: [number, number]): number[] {
  const pitches: number[] = [];
  for (let pitch = low; pitch <= high; pitch++) {
    if (pitchClasses.includes(pitch % 12)) {
      pitches.push(pitch);
    }
  }

  return pitches;
}

function staffRange(part: PartSpec, staff: number): [number, number] {
  const [low, high] = part.range;
  if (part.clefs.length === 1) {
    return part.range;
  }

  return staff === 0 ? [Math.max(low, GRAND_STAFF_SPLIT_PITCH), high] : [low, Math.min(high, GRAND_STAFF_SPLIT_PITCH - 1)];
}

/** Splits a bar into note lengths. Falls back to eighths so every bar is filled exactly. */
function partition(random: Random, lengthUnits: number, pieces: number[]): number[] {
  const result: number[] = [];
  let remaining = lengthUnits;

  while (remaining > 0) {
    const fitting = pieces.filter(piece => piece <= remaining);
    const piece = fitting.length > 0 ? random.pick(fitting) : 1;
    result.push(piece);
    remaining -= piece;
  }

  return result;
}

function closest(candidates: number[], target: number): number {
  return candidates.reduce((best, candidate) => (Math.abs(candidate - target) < Math.abs(best - target) ? candidate : best));
}

type VoiceState = { pitch: number; syllableIndex: number };

function composeVocal(random: Random, spec: ScoreSpec, part: PartSpec, measure: TimelineMeasure, state: VoiceState): TimelineEvent[] {
  const pieces = measure.timeSignature.beatType === 4 ? [2, 2, 4, 6, 8] : [3, 3, 1, 2, 6];
  const candidates = pitchesInRange(chordPitchClasses(spec.keyFifths, measure.chordRootDegree), part.range);
  let offset = 0;

  return partition(random, measure.lengthUnits, pieces).map((duration) => {
    const target = state.pitch + random.int(-4, 4);
    state.pitch = closest(candidates, target);
    const syllables = part.syllables ?? [];
    const lyric = syllables.length > 0 ? syllables[state.syllableIndex++ % syllables.length] : undefined;
    const event: TimelineEvent = {
      partId: part.id,
      staff: 0,
      measureIndex: measure.index,
      offsetUnits: offset,
      durationUnits: duration,
      pitches: [state.pitch],
      isMeasureRest: false,
      velocity: VOCAL_VELOCITY,
      lyric,
    };
    offset += duration;
    return event;
  });
}

function composeAccompaniment(random: Random, spec: ScoreSpec, part: PartSpec, measure: TimelineMeasure, staff: number): TimelineEvent[] {
  const range = staffRange(part, staff);
  const candidates = pitchesInRange(chordPitchClasses(spec.keyFifths, measure.chordRootDegree), range);
  const center = (range[0] + range[1]) / 2;
  const isUpperStaff = staff === 0 && part.clefs.length > 1;
  const beatUnits = unitsPerBeat(measure.timeSignature);
  const pieces = isUpperStaff
    ? [beatUnits]
    : [beatUnits, beatUnits * 2, beatUnits * 3, beatUnits * 4].filter(p => NOTATABLE_UNITS.includes(p));

  let offset = 0;
  return partition(random, measure.lengthUnits, pieces).map((duration) => {
    const lowest = closest(candidates, isUpperStaff ? center - 4 : range[0] + 5);
    const pitches = isUpperStaff ? candidates.filter(p => p >= lowest).slice(0, 3) : [lowest];
    const event: TimelineEvent = {
      partId: part.id,
      staff,
      measureIndex: measure.index,
      offsetUnits: offset,
      durationUnits: duration,
      pitches,
      isMeasureRest: false,
      velocity: ACCOMPANIMENT_VELOCITY,
      lyric: undefined,
    };
    offset += duration;
    return event;
  });
}

function measureRest(part: PartSpec, staff: number, measure: TimelineMeasure): TimelineEvent {
  return {
    partId: part.id,
    staff,
    measureIndex: measure.index,
    offsetUnits: 0,
    durationUnits: measure.lengthUnits,
    pitches: [],
    isMeasureRest: true,
    velocity: 0,
    lyric: undefined,
  };
}

function composeEvents(spec: ScoreSpec, measures: TimelineMeasure[], random: Random): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const part of spec.parts) {
    if (part.classification === "Percussion") {
      throw new Error(`Part '${part.id}': percussion parts are not supported by the score generator yet.`);
    }

    const state: VoiceState = { pitch: Math.round((part.range[0] + part.range[1]) / 2), syllableIndex: 0 };

    for (const measure of measures) {
      const isTacet = spec.sections[measure.sectionIndex]!.tacet?.includes(part.id) ?? false;

      part.clefs.forEach((_, staff) => {
        if (isTacet) {
          events.push(measureRest(part, staff, measure));
        } else if (part.classification === "Vocal") {
          events.push(...composeVocal(random, spec, part, measure, state));
        } else {
          events.push(...composeAccompaniment(random, spec, part, measure, staff));
        }
      });
    }
  }

  return events;
}

/**
 * Expands a score spec into bars and notes. Every export (MusicXML, MIDI, MTI JSON, audio, song
 * record) is derived from the same timeline, which keeps them consistent with each other.
 */
export function buildTimeline(spec: ScoreSpec): Timeline {
  const random = createRandom(spec.seed);
  const measures = buildMeasures(spec, random);
  const events = composeEvents(spec, measures, random);
  const lastMeasure = measures[measures.length - 1]!;
  const tempoChanges = measures
    .filter(measure => measure.tempoChange !== undefined)
    .map(measure => ({ tick: measure.startTick, bpm: measure.tempoChange! }));

  return {
    spec,
    measures,
    events,
    tempoChanges,
    durationTicks: lastMeasure.startTick + lastMeasure.lengthUnits * TICKS_PER_UNIT,
  };
}

export function terminalMeasureNumber(timeline: Timeline): string {
  const lastRegular = [...timeline.measures].reverse().find(measure => /^\d+$/.test(measure.number));
  return String(Number(lastRegular?.number ?? "0") + 1);
}
