import type { MTIMidiJson } from "../core/midi/mtiJson";
import Measure, { type MeasureId, type MeasureLayout } from "../core/models/measure";
import type { Location, RecordingSpan, StoredWarpMarker } from "../core/models/recording";
import type { Section, VampOut, VampVocals } from "../core/models/sections";
import Song from "../core/models/song";
import Track from "../core/models/track";
import { buildMidiBuffer, type TestTrack } from "./midi";

// Constants

export const PPQN = 480;

const TICKS_PER_BEAT = 480;
const PICKUP_BEATS = 1;
const BEATS_PER_MEASURE = 4;
const TEMPO_CHANGE_POSITION = 3;

// At 120 BPM with ppqn=480: 120/60 × 480 = 1600 ticks/sec, so 480 ticks per beat.
// Position 0 is a pickup of 1 beat. Every later position is a 4/4 measure of 1920 ticks, and the tempo
// changes to 140 BPM at position 3. The beat map ends with a terminal measure of 1 beat that only gives
// the last measure its length. The plain layout plays measures "0" to "4":
//   "0": ticks    0 –  479
//   "1": ticks  480 – 2399
//   "2": ticks 2400 – 4319
//   "3": ticks 4320 – 6239  (140 BPM)
//   "4": ticks 6240 – 8159
//   terminal "5" at tick 8160 = duration
// Layouts with more positions continue the same way, see `positionTick()`.

export function positionTick(position: number): number {
  return position === 0 ? 0 : (PICKUP_BEATS + (position - 1) * BEATS_PER_MEASURE) * TICKS_PER_BEAT;
}

export const TICKS = {
  measure0: positionTick(0),
  measure1: positionTick(1),
  measure2: positionTick(2),
  measure3: positionTick(3),
  measure4: positionTick(4),
  measure5: positionTick(5),
  duration: positionTick(5),
} as const;

/** Beat map labels in play order, ending with the terminal measure. Each fits the MIDI song of the same layout. */
export const BEAT_MAP_LABELS = {
  plain: ["0", "1", "2", "3", "4", "5"],
  /** Measures "2" and "3" recorded three times (B = 3), ending at `positionTick(9)`. */
  repeat: ["0", "1", "2", "3", "2-2", "3-2", "2-3", "3-3", "4", "5"],
  /** Measure "2" recorded four times (B = 4), ending at `positionTick(8)`. */
  bakedVamp: ["0", "1", "2", "2-2", "2-3", "2-4", "3", "4", "5"],
} as const;

export const TRACK_NAMES = { instrument: "Instrument", vocals: "Vocals" } as const;

// Notes in measure 1 and 2 (before tempo change), vocals in measure 3
export const MIDI_TRACKS: TestTrack[] = [
  {
    name: TRACK_NAMES.instrument,
    channel: 0,
    notes: [
      { tick: 480, duration: 240, pitch: 60 }, // C4, measure 1 beat 1
      { tick: 2400, duration: 240, pitch: 64 }, // E4, measure 2 beat 1
    ],
  },
  {
    name: TRACK_NAMES.vocals,
    channel: 1,
    notes: [
      { tick: 4320, duration: 480, pitch: 67 }, // G4, measure 3 beat 1
      { tick: 5280, duration: 480, pitch: 69 }, // A4, measure 3 beat 3
    ],
  },
];

// midi-json-parser output for MIDI_TRACKS, returned by the global mock in setup.ts
export const PARSED_MIDI = {
  tracks: [
    [],
    [
      { delta: 0, trackName: TRACK_NAMES.instrument },
      { delta: 480, noteOn: { noteNumber: 60, velocity: 80 } },
      { delta: 240, noteOff: { noteNumber: 60, velocity: 0 } },
      { delta: 1680, noteOn: { noteNumber: 64, velocity: 80 } },
      { delta: 240, noteOff: { noteNumber: 64, velocity: 0 } },
    ],
    [
      { delta: 0, trackName: TRACK_NAMES.vocals },
      { delta: 4320, noteOn: { noteNumber: 67, velocity: 80 } },
      { delta: 480, noteOff: { noteNumber: 67, velocity: 0 } },
      { delta: 480, noteOn: { noteNumber: 69, velocity: 80 } },
      { delta: 480, noteOff: { noteNumber: 69, velocity: 0 } },
    ],
  ],
};

// Song factories

function makeLayout(x: number): MeasureLayout {
  return { page: 0, x, y: 0, width: 0.18, height: 0.1 };
}

/** Measures with the IDs "m1", "m2", ... in score order. */
function makeMeasures(labels: readonly string[], pickup: boolean): Measure[] {
  const step = 0.9 / labels.length;
  return labels.map((label, i) => {
    const beats = pickup && i === 0 ? PICKUP_BEATS : BEATS_PER_MEASURE;
    return new Measure(`m${i + 1}`, label, beats, makeLayout(i * step));
  });
}

/** The ID of the measure with the given label, so tests need no hard-coded IDs. */
export function idOf(song: Song, label: string): MeasureId {
  const measure = song.findMeasureByLabel(label);
  if (!measure) {
    throw new Error(`The fixture song has no measure ${label}.`);
  }

  return measure.id;
}

/** A location by measure label, for tests. */
export function locationOf(song: Song, label: string, beat = 0, occurrence = 1): Location {
  return { measure: idOf(song, label), beat, occurrence };
}

type LabelSpan = [from: string, to: string];
type LabelBeat = [label: string, beat: number];

type LabelSection
  = | { kind: "cut"; from: LabelBeat; to: LabelBeat }
    | { kind: "repeat"; from: LabelBeat; to: LabelBeat; passes: number }
    | { kind: "vamp"; from: LabelBeat; to: LabelBeat; out?: VampOut; vocals?: VampVocals };

type FixtureLayout = {
  spans: LabelSpan[];
  sections?: LabelSection[];
};

function findId(measures: readonly Measure[], label: string): MeasureId {
  return measures.find(measure => measure.label === label)!.id;
}

function toSpans(measures: readonly Measure[], spans: LabelSpan[]): RecordingSpan[] {
  return spans.map(([from, to]) => ({ from: findId(measures, from), to: findId(measures, to) }));
}

function toSection(measures: readonly Measure[], section: LabelSection): Section {
  const at = ([label, beat]: LabelBeat): Location => ({ measure: findId(measures, label), beat, occurrence: 1 });
  const range = { from: at(section.from), to: at(section.to) };

  switch (section.kind) {
    case "cut":
      return { kind: "cut", ...range };
    case "repeat":
      return { kind: "repeat", ...range, passes: section.passes };
    case "vamp":
      return { kind: "vamp", ...range, out: section.out ?? "onEnd", vocals: section.vocals ?? "all" };
  }
}

const MIDI_LABELS = ["0", "1", "2", "3", "4"];
const MIDI_PLAIN: LabelSpan[] = [["0", "4"]];
const MIDI_REPEAT: LabelSpan[] = [["0", "3"], ["2", "3"], ["2", "4"]];
const MIDI_BAKED_VAMP: LabelSpan[] = [["0", "2"], ["2", "2"], ["2", "2"], ["2", "4"]];

function makeMidiFixture(id: string, title: string, { spans, sections = [] }: FixtureLayout): Song {
  const measures = makeMeasures(MIDI_LABELS, true);
  const tracks = [
    new Track(TRACK_NAMES.instrument, "Accompaniment", 0),
    new Track(TRACK_NAMES.vocals, "Vocal", 1),
  ];

  return new Song(id, "1", title, "test.mid", "test.json", undefined, [], tracks, {
    measures,
    spans: toSpans(measures, spans),
    sections: sections.map(section => toSection(measures, section)),
  });
}

/** Plays measures "0" to "4" straight through, with the tick layout of `TICKS`. */
export function makeMidiSong(): Song {
  return makeMidiFixture("test-midi-song", "Test MIDI Song", { spans: MIDI_PLAIN });
}

/** Vamps measure "2", which the plain layout recorded once. */
export function makeMidiSongWithVamp(): Song {
  return makeMidiFixture("test-midi-song-vamp", "Test MIDI Song with Vamp", {
    spans: MIDI_PLAIN,
    sections: [{ kind: "vamp", from: ["2", 0], to: ["2", 3] }],
  });
}

/** Repeats measures "2" and "3", which `BEAT_MAP_LABELS.repeat` recorded three times. */
export function makeMidiSongWithRepeat(passes = 3): Song {
  return makeMidiFixture("test-midi-song-repeat", "Test MIDI Song with Repeat", {
    spans: MIDI_REPEAT,
    sections: [{ kind: "repeat", from: ["2", 0], to: ["3", 3], passes }],
  });
}

/** Cuts measures "2" and "3" from the plain layout. */
export function makeMidiSongWithCut(): Song {
  return makeMidiFixture("test-midi-song-cut", "Test MIDI Song with Cut", {
    spans: MIDI_PLAIN,
    sections: [{ kind: "cut", from: ["2", 0], to: ["3", 3] }],
  });
}

export type VampOptions = { out?: VampOut; vocals?: VampVocals };

/** Vamps measure "2", which `BEAT_MAP_LABELS.bakedVamp` recorded four times. */
export function makeMidiSongWithBakedVamp({ out, vocals }: VampOptions = {}): Song {
  return makeMidiFixture("test-midi-song-baked-vamp", "Test MIDI Song with Baked Vamp", {
    spans: MIDI_BAKED_VAMP,
    sections: [{ kind: "vamp", from: ["2", 0], to: ["2", 3], out, vocals }],
  });
}

const AUDIO_LABELS = ["1", "2", "3", "4"];
const AUDIO_PLAIN: LabelSpan[] = [["1", "4"]];
const AUDIO_REPEAT: LabelSpan[] = [["1", "3"], ["2", "3"], ["2", "4"]];
const AUDIO_BAKED_VAMP: LabelSpan[] = [["1", "2"], ["2", "2"], ["2", "2"], ["2", "4"]];

type LabelWarpMarker = [label: string, occurrence: number, time: number];

type AudioFixtureLayout = FixtureLayout & {
  tracks?: Track[];
  warpMarkers?: LabelWarpMarker[];
};

// Markers at positions 0 and 2, 0.5 s apart, place every position 0.25 s after the previous one, so
// the first four positions fit the 1-second test buffer in engine.audio.test.ts.
const QUARTER_SECOND_POSITIONS: LabelWarpMarker[] = [["1", 1, 0.0], ["3", 1, 0.5]];

// The baked vamp plays measure "2" again at position 2, so the same spacing needs another anchor.
const BAKED_VAMP_QUARTER_SECOND_POSITIONS: LabelWarpMarker[] = [["1", 1, 0.0], ["2", 2, 0.5]];

function makeAudioFixture(id: string, title: string, { spans, sections = [], tracks, warpMarkers = [] }: AudioFixtureLayout): Song {
  const measures = makeMeasures(AUDIO_LABELS, false);
  const songTracks = tracks ?? [new Track("Mix", "Accompaniment", 0, "mix.mp3")];
  const markers: StoredWarpMarker[] = warpMarkers.map(([label, occurrence, time]) => ({
    measure: findId(measures, label),
    occurrence,
    time,
  }));

  return new Song(id, "1", title, undefined, undefined, undefined, songTracks.map(track => track.audioFile), songTracks, {
    measures,
    spans: toSpans(measures, spans),
    warpMarkers: markers,
    sections: sections.map(section => toSection(measures, section)),
  });
}

/** Plays measures "1" to "4" straight through, without warp markers. */
export function makeAudioSong(): Song {
  return makeAudioFixture("test-audio-song", "Audio Test Song", { spans: AUDIO_PLAIN });
}

/** Vamps measure "2" (250 ms to 500 ms) on the plain layout. */
export function makeAudioSongWithVamp(): Song {
  return makeAudioFixture("test-audio-song-vamp", "Audio Test Song with Vamp", {
    spans: AUDIO_PLAIN,
    sections: [{ kind: "vamp", from: ["2", 0], to: ["2", 3] }],
    warpMarkers: QUARTER_SECOND_POSITIONS,
  });
}

/** Like `makeAudioSongWithVamp()`, with a vocal track that the vamp's vocals mode mutes. */
export function makeAudioSongWithVocalVamp(vocals: VampVocals = "split"): Song {
  return makeAudioFixture("test-audio-song-vocal-vamp", "Audio Test Song with Vocal Vamp", {
    spans: AUDIO_PLAIN,
    sections: [{ kind: "vamp", from: ["2", 0], to: ["2", 3], vocals }],
    tracks: [
      new Track("Accompaniment", "Accompaniment", 0, "accomp.mp3"),
      new Track("Vocals", "Vocal", 0, "vocal.mp3"),
    ],
    warpMarkers: QUARTER_SECOND_POSITIONS,
  });
}

/**
 * Vamps measures "2" and "3" (250 ms to 750 ms) until released. The internal barline is measure "3" at
 * 500 ms, and beats are 62.5 ms apart.
 */
export function makeAudioSongWithVampOut(out: VampOut): Song {
  return makeAudioFixture(`test-audio-song-vamp-${out}`, `Audio Test Song (out=${out})`, {
    spans: AUDIO_PLAIN,
    sections: [{ kind: "vamp", from: ["2", 0], to: ["3", 3], out }],
    warpMarkers: QUARTER_SECOND_POSITIONS,
  });
}

/** Repeats measures "2" and "3", which the recording plays three times (positions 1 to 6). */
export function makeAudioSongWithRepeat(passes = 3): Song {
  return makeAudioFixture("test-audio-song-repeat", "Audio Test Song with Repeat", {
    spans: AUDIO_REPEAT,
    sections: [{ kind: "repeat", from: ["2", 0], to: ["3", 3], passes }],
    warpMarkers: QUARTER_SECOND_POSITIONS,
  });
}

/** Cuts measures "2" and "3" from the plain layout. */
export function makeAudioSongWithCut(): Song {
  return makeAudioFixture("test-audio-song-cut", "Audio Test Song with Cut", {
    spans: AUDIO_PLAIN,
    sections: [{ kind: "cut", from: ["2", 0], to: ["3", 3] }],
    warpMarkers: QUARTER_SECOND_POSITIONS,
  });
}

/** Vamps measure "2", which the recording plays four times (positions 1 to 4). */
export function makeAudioSongWithBakedVamp({ out, vocals }: VampOptions = {}): Song {
  return makeAudioFixture("test-audio-song-baked-vamp", "Audio Test Song with Baked Vamp", {
    spans: AUDIO_BAKED_VAMP,
    sections: [{ kind: "vamp", from: ["2", 0], to: ["2", 3], out, vocals }],
    warpMarkers: BAKED_VAMP_QUARTER_SECOND_POSITIONS,
  });
}

// MTIMidiJson factory

type MtiEvent = MTIMidiJson["score"]["events"][number];

function beatEvents(label: string, position: number, beats: number): MtiEvent[] {
  const tick = positionTick(position);
  return Array.from({ length: beats }, (_, i): MtiEvent => ({
    tickcount: tick + i * TICKS_PER_BEAT,
    type: "BEAT",
    value: { meas: label, beat: i + 1, tick: 0 },
  }));
}

function positionEvents(label: string, position: number, terminal: boolean): MtiEvent[] {
  const tick = positionTick(position);
  const events: MtiEvent[] = [];

  if (position === 1) {
    events.push({ tickcount: tick, type: "TIMESIG", value: { numerator: 4, denominator: 2, metroCount: 24, _32nds: 8 } });
  }

  if (position === TEMPO_CHANGE_POSITION) {
    events.push({ tickcount: tick, type: "TEMPO", value: { bpm: 140, ticksPerQuarter: 428571 } });
  }

  const beats = position === 0 || terminal ? PICKUP_BEATS : BEATS_PER_MEASURE;
  return [...events, ...beatEvents(label, position, beats)];
}

/** A beat map that plays the given labels in order. The last label is the terminal measure. */
export function makeMtiJson(labels: readonly string[] = BEAT_MAP_LABELS.plain): MTIMidiJson {
  const events: MtiEvent[] = [
    { tickcount: 0, type: "TEMPO", value: { bpm: 120, ticksPerQuarter: 500000 } },
    { tickcount: 0, type: "TIMESIG", value: { numerator: 1, denominator: 2, metroCount: 24, _32nds: 8 } },
    ...labels.flatMap((label, position) => positionEvents(label, position, position === labels.length - 1)),
  ];

  return {
    score: {
      title: "Test Song",
      ppqn: PPQN,
      trackNames: {
        cnt: 2,
        track: [
          { name: TRACK_NAMES.instrument, channel: 0 },
          { name: TRACK_NAMES.vocals, channel: 1 },
        ],
      },
      jumpTable: { cnt: 0, entries: [] },
      events,
    },
  };
}

export function makeMidiBuffer(): ArrayBuffer {
  return buildMidiBuffer(PPQN, MIDI_TRACKS);
}

// Audio analysis helper

export function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]! ** 2;
  }

  return Math.sqrt(sum / samples.length);
}
