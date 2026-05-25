import Measure, { type MeasureLayout, MeasureList } from "../core/models/measure";
import { MarkerEvent, MeasureEventList, VampEvent, type VampVocals } from "../core/models/measureEvent";
import Song from "../core/models/song";
import Track from "../core/models/track";
import type { MTIMidiJson } from "../core/scripts/jsonTypes/mti";
import { buildMidiBuffer, type TestTrack } from "./midi";

// ── Constants ─────────────────────────────────────────────────────────────────

export const PPQN = 480;

// At 120 BPM with ppqn=480: 120/60 × 480 = 1600 ticks/sec → 480 ticks/beat
// Measure "0": pickup, 1 beat  (tick   0 –  479)
// Measures "1"–"4": 4/4, each 1920 ticks
//   "1": ticks  480 – 2399
//   "2": ticks 2400 – 4319
//   "3": ticks 4320 – 6239  ← tempo changes here to 140 BPM
//   "4": ticks 6240 – 8159
// Measure "5": terminal (no layout), beat 1 at tick 8160 → sets measure "4".$tickLength

const MEASURE_TICKS: Record<string, number[]> = {
  0: [0],
  1: [480, 960, 1440, 1920],
  2: [2400, 2880, 3360, 3840],
  3: [4320, 4800, 5280, 5760],
  4: [6240, 6720, 7200, 7680],
  5: [8160],
};

export const TICKS = {
  measure0: 0,
  measure1: 480,
  measure2: 2400,
  measure3: 4320,
  measure4: 6240,
  measure5: 8160,
  duration: 8160, // measure4.tick + measure4.tickLength (1920)
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

// ── Song factories ────────────────────────────────────────────────────────────

function makeLayout(x: number): MeasureLayout {
  return { page: 0, x, y: 0, width: 0.18, height: 0.1 };
}

export function makeMidiSong(): Song {
  const measures = new MeasureList([
    new Measure("0", 1, makeLayout(0.00)),
    new Measure("1", 4, makeLayout(0.10)),
    new Measure("2", 4, makeLayout(0.28)),
    new Measure("3", 4, makeLayout(0.46)),
    new Measure("4", 4, makeLayout(0.64)),
    new Measure("5", 4, undefined), // terminal – no layout
  ]);

  const tracks = [
    new Track(TRACK_NAMES.instrument, "Accompaniment", 0),
    new Track(TRACK_NAMES.vocals, "Vocal", 1),
  ];

  return new Song(
    "test-midi-song",
    "1",
    "Test MIDI Song",
    "test.mid",
    "test.json",
    undefined,
    [],
    tracks,
    measures,
  );
}

export function makeMidiSongWithVamp(): Song {
  const song = makeMidiSong();
  // Vamp from start of measure "2" to start of measure "3", 2 iterations
  (song.events.vamps as MeasureEventList<VampEvent>).insert(
    new VampEvent(["2", 0], ["3", 0], 2),
  );
  return song;
}

export function makeAudioSong(): Song {
  const audioFile = "mix.mp3";
  const measures = new MeasureList([
    new Measure("1", 4, makeLayout(0.00)),
    new Measure("2", 4, makeLayout(0.25)),
    new Measure("3", 4, makeLayout(0.50)),
    new Measure("4", 4, makeLayout(0.75)),
  ]);
  const tracks = [new Track("Mix", "Accompaniment", 0, audioFile)];

  return new Song(
    "test-audio-song",
    "1",
    "Audio Test Song",
    undefined, // no midiFile → audio mode
    undefined,
    undefined,
    [audioFile],
    tracks,
    measures,
  );
}

export function makeAudioSongWithVocalVamp(vocals: VampVocals = "split"): Song {
  const accompFile = "accomp.mp3";
  const vocalFile = "vocal.mp3";
  const measures = new MeasureList([
    new Measure("1", 4, makeLayout(0.00)),
    new Measure("2", 4, makeLayout(0.25)),
    new Measure("3", 4, makeLayout(0.50)),
    new Measure("4", 4, makeLayout(0.75)),
  ]);
  const tracks = [
    new Track("Accompaniment", "Accompaniment", 0, accompFile),
    new Track("Vocals", "Vocal", 0, vocalFile),
  ];
  const vamps = new MeasureEventList<VampEvent>();
  // Vamp from measure "2" (250 ms) to measure "3" (500 ms), 2 iterations.
  // Midpoint = 375 ms. Last pass = currentIteration >= 2.
  vamps.insert(new VampEvent(["2", 0], ["3", 0], 2, undefined, vocals));

  return new Song(
    "test-audio-song-vocal-vamp", "1", "Audio Test Song with Vocal Vamp",
    undefined, undefined, undefined,
    [accompFile, vocalFile], tracks, measures,
    { markers: new MeasureEventList<MarkerEvent>(), vamps, segue: false },
    [{ measure: "1", time: 0.0 }, { measure: "3", time: 0.5 }],
  );
}

export function makeAudioSongWithVamp(): Song {
  const audioFile = "mix.mp3";
  const measures = new MeasureList([
    new Measure("1", 4, makeLayout(0.00)),
    new Measure("2", 4, makeLayout(0.25)),
    new Measure("3", 4, makeLayout(0.50)),
    new Measure("4", 4, makeLayout(0.75)),
  ]);
  const tracks = [new Track("Mix", "Accompaniment", 0, audioFile)];
  const vamps = new MeasureEventList<VampEvent>();
  vamps.insert(new VampEvent(["2", 0], ["3", 0], 2));

  // Two warp markers give 0.25 s/measure → measure "2" at 250 ms, "3" at 500 ms,
  // both within the 1-second test buffer in engine.audio.test.ts.
  return new Song(
    "test-audio-song-vamp", "1", "Audio Test Song with Vamp",
    undefined, undefined, undefined,
    [audioFile], tracks, measures,
    { markers: new MeasureEventList<MarkerEvent>(), vamps, segue: false },
    [{ measure: "1", time: 0.0 }, { measure: "3", time: 0.5 }],
  );
}

export function makeAudioSongWithVampOut(out: "onEnd" | "anyBar" | "anyBeat"): Song {
  const audioFile = "mix.mp3";
  const measures = new MeasureList([
    new Measure("1", 4, makeLayout(0.00)),
    new Measure("2", 4, makeLayout(0.25)),
    new Measure("3", 4, makeLayout(0.50)),
    new Measure("4", 4, makeLayout(0.75)),
  ]);
  const tracks = [new Track("Mix", "Accompaniment", 0, audioFile)];
  const vamps = new MeasureEventList<VampEvent>();
  // Infinite vamp (iterations=0) from measure "2" (250 ms) to measure "4" (750 ms), spanning 2 measures.
  // Internal barline: measure "3" at 500 ms. Beat ticks (4/measure): 250, 312.5, 375, 437.5, 500, … ms.
  vamps.insert(new VampEvent(["2", 0], ["4", 0], 0, out));

  return new Song(
    `test-audio-song-vamp-${out}`, "1", `Audio Test Song (out=${out})`,
    undefined, undefined, undefined,
    [audioFile], tracks, measures,
    { markers: new MeasureEventList<MarkerEvent>(), vamps, segue: false },
    [{ measure: "1", time: 0.0 }, { measure: "3", time: 0.5 }],
  );
}

// ── MTIMidiJson factory ────────────────────────────────────────────────────────

export function makeMtiJson(): MTIMidiJson {
  const events: MTIMidiJson["score"]["events"] = [
    { tickcount: 0, type: "TEMPO", value: { bpm: 120, ticksPerQuarter: 500000 } },
    { tickcount: 0, type: "TIMESIG", value: { numerator: 1, denominator: 2, metroCount: 24, _32nds: 8 } },
    { tickcount: 0, type: "BEAT", value: { meas: "0", beat: 1, tick: 0 } },
    { tickcount: 480, type: "TIMESIG", value: { numerator: 4, denominator: 2, metroCount: 24, _32nds: 8 } },
    // measure 1
    { tickcount: 480, type: "BEAT", value: { meas: "1", beat: 1, tick: 0 } },
    { tickcount: 960, type: "BEAT", value: { meas: "1", beat: 2, tick: 0 } },
    { tickcount: 1440, type: "BEAT", value: { meas: "1", beat: 3, tick: 0 } },
    { tickcount: 1920, type: "BEAT", value: { meas: "1", beat: 4, tick: 0 } },
    // measure 2
    { tickcount: 2400, type: "BEAT", value: { meas: "2", beat: 1, tick: 0 } },
    { tickcount: 2880, type: "BEAT", value: { meas: "2", beat: 2, tick: 0 } },
    { tickcount: 3360, type: "BEAT", value: { meas: "2", beat: 3, tick: 0 } },
    { tickcount: 3840, type: "BEAT", value: { meas: "2", beat: 4, tick: 0 } },
    // measure 3: tempo change 120 → 140 BPM
    { tickcount: 4320, type: "TEMPO", value: { bpm: 140, ticksPerQuarter: 428571 } },
    { tickcount: 4320, type: "BEAT", value: { meas: "3", beat: 1, tick: 0 } },
    { tickcount: 4800, type: "BEAT", value: { meas: "3", beat: 2, tick: 0 } },
    { tickcount: 5280, type: "BEAT", value: { meas: "3", beat: 3, tick: 0 } },
    { tickcount: 5760, type: "BEAT", value: { meas: "3", beat: 4, tick: 0 } },
    // measure 4
    { tickcount: 6240, type: "BEAT", value: { meas: "4", beat: 1, tick: 0 } },
    { tickcount: 6720, type: "BEAT", value: { meas: "4", beat: 2, tick: 0 } },
    { tickcount: 7200, type: "BEAT", value: { meas: "4", beat: 3, tick: 0 } },
    { tickcount: 7680, type: "BEAT", value: { meas: "4", beat: 4, tick: 0 } },
    // terminal measure 5 beat 1 – triggers measure "4".$tickLength = 8160 − 6240 = 1920
    { tickcount: 8160, type: "BEAT", value: { meas: "5", beat: 1, tick: 0 } },
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

// ── Audio analysis helper ─────────────────────────────────────────────────────

export function computeRms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i]! ** 2;
  }

  return Math.sqrt(sum / samples.length);
}

export function makeSineBuffer(ctx: OfflineAudioContext, freq: number, durationSec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const buf = ctx.createBuffer(2, Math.floor(sr * durationSec), sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr);
    }
  }

  return buf;
}

// Silence unused import – MEASURE_TICKS is used only for documentation above.
void MEASURE_TICKS;
