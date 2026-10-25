import { encodeMp3, type Mp3Options, type RenderOptions, renderPartStem } from "./audio";
import { toMidiFile } from "./midi";
import { toMtiJson } from "./mtiJson";
import { type RecordedRepeat, type Recording, recordTimeline } from "./recording";
import { loadScoreAssets, type MeasureLayout } from "./score/assets";
import { buildTimeline, tickToSeconds, type Timeline, type TimelineMeasure } from "./score/timeline";
import type { ScoreSpec, TrackClassification } from "./score/types";

export type SongMode = "midi" | "audio" | "none";

export type SongTrack = {
  title: string;
  classification: TrackClassification;
  program: number;
  /** In a bundle this is the local file name. PocketBase renames uploads, see `createSong()`. */
  audioFile: string;
};

export type SongLayout = MeasureLayout & { review?: boolean };
export type SongMeasure = { id: string; label: string; beats: number; layout?: SongLayout };
export type SongSpan = { from: string; to: string };
export type SongWarpMarker = { measure: string; occurrence: number; time: number };
export type SongLocation = { measure: string; beat: number; occurrence?: number };
export type SongMarker = { at: SongLocation; text: string };
export type SongVampOut = "onEnd" | "anyBar" | "anyBeat";
export type SongVampVocals = "all" | "first" | "last" | "split";
export type SongSection
  = | { kind: "cut"; from: SongLocation; to: SongLocation }
    | { kind: "repeat"; from: SongLocation; to: SongLocation; passes: number }
    | { kind: "vamp"; from: SongLocation; to: SongLocation; passes: number; out: SongVampOut; vocals: SongVampVocals };

export type SongScore = { measures: SongMeasure[]; unnumberedBoxes: MeasureLayout[] };
export type SongRecording = { spans: SongSpan[]; warpMarkers: SongWarpMarker[] };
export type SongArrangement = { markers: SongMarker[]; sections: SongSection[]; segue: boolean };

/** The JSON fields of a `songs` record, in the shape `Song.serialize()` writes. */
export type SongFields = {
  number: string;
  title: string;
  tracks: SongTrack[];
  score: SongScore;
  recording: SongRecording;
  arrangement: SongArrangement;
};

export type SongFiles = {
  pdfFile?: File;
  midiFile?: File;
  jsonFile?: File;
  audioFiles: File[];
};

export type SongBundle = {
  spec: ScoreSpec;
  /** The printed score. */
  timeline: Timeline;
  /** What the MIDI file, beat map and audio play, including recorded repeats. */
  recording: Recording;
  fields: SongFields;
  files: SongFiles;
};

export type SongBundleOptions = {
  mode: SongMode;
  /** Attach the committed PDF and measure layouts. Requires generated score assets. */
  withPdf?: boolean;
  audio?: RenderOptions & Mp3Options;
  /** Ranges the recording plays several times, like written repeats or a vamp baked into the audio. */
  repeats?: RecordedRepeat[];
};

function fileName(spec: ScoreSpec, suffix: string): string {
  return `${spec.id}-${suffix}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

function measureIdAt(index: number): string {
  return `m${index + 1}`;
}

function buildScore(timeline: Timeline, layouts: Map<string, MeasureLayout> | undefined): SongScore {
  const measures = timeline.measures.map((measure): SongMeasure => {
    const layout = layouts?.get(measure.number);
    return { id: measureIdAt(measure.index), label: measure.number, beats: measure.beats, ...(layout ? { layout } : {}) };
  });

  return { measures, unnumberedBoxes: [] };
}

/** Maximal runs of bars that move forward by one in score order, as the app builds them from a beat map. */
function buildSpans(recording: Recording): SongSpan[] {
  const spans: SongSpan[] = [];
  let previous = -1;

  for (const { measure } of recording.bars) {
    const current = spans.at(-1);
    if (current && measure.index === previous + 1) {
      current.to = measureIdAt(measure.index);
    } else {
      spans.push({ from: measureIdAt(measure.index), to: measureIdAt(measure.index) });
    }

    previous = measure.index;
  }

  return spans;
}

function buildWarpMarkers(recording: Recording, mode: SongMode, leadingSilenceSeconds: number): SongWarpMarker[] {
  if (mode !== "audio") {
    return [];
  }

  return recording.bars.map((bar, index) => ({
    measure: measureIdAt(bar.measure.index),
    occurrence: bar.occurrence,
    time: leadingSilenceSeconds + tickToSeconds(recording.timeline, recording.timeline.measures[index]!.startTick),
  }));
}

function buildArrangement(timeline: Timeline): SongArrangement {
  const markers: SongMarker[] = timeline.measures
    .filter(measure => measure.rehearsalMark)
    .map(measure => ({ at: { measure: measureIdAt(measure.index), beat: 0 }, text: measure.rehearsalMark! }));

  const sections: SongSection[] = [];
  let vampStart: TimelineMeasure | undefined;

  for (const measure of timeline.measures) {
    if (measure.vampStart) {
      vampStart = measure;
    }

    if (measure.vampEnd && vampStart) {
      sections.push({
        kind: "vamp",
        from: { measure: measureIdAt(vampStart.index), beat: 0 },
        to: { measure: measureIdAt(measure.index), beat: measure.beats - 1 },
        passes: measure.vampEnd.iterations,
        out: "onEnd",
        vocals: "all",
      });
      vampStart = undefined;
    }
  }

  return { markers, sections, segue: false };
}

function buildTracks(timeline: Timeline, mode: SongMode): SongTrack[] {
  if (mode === "none") {
    return [];
  }

  return timeline.spec.parts.map(part => ({
    title: part.name,
    classification: part.classification,
    program: part.program,
    audioFile: mode === "audio" ? fileName(timeline.spec, `${part.id}.mp3`) : "",
  }));
}

async function buildAudioFiles(timeline: Timeline, options: SongBundleOptions["audio"] = {}): Promise<File[]> {
  return Promise.all(timeline.spec.parts.map(async (part) => {
    const mp3 = await encodeMp3(renderPartStem(timeline, part.id, options), options);
    return new File([mp3], fileName(timeline.spec, `${part.id}.mp3`), { type: "audio/mpeg" });
  }));
}

/**
 * Builds everything needed for a `songs` record from one score spec: JSON fields and the PDF,
 * MIDI, beat map and audio files. MIDI and audio are generated on the fly from the recording; the
 * PDF comes from the committed score assets.
 */
export async function buildSongBundle(spec: ScoreSpec, { mode, withPdf = true, audio = {}, repeats = [] }: SongBundleOptions): Promise<SongBundle> {
  const timeline = buildTimeline(spec);
  const recording = recordTimeline(timeline, repeats);
  const assets = withPdf ? loadScoreAssets(spec) : undefined;
  const layouts = assets ? new Map(assets.layout.measures.map(m => [m.number, m.layout])) : undefined;

  const files: SongFiles = { audioFiles: [] };

  if (assets) {
    files.pdfFile = new File([new Uint8Array(assets.pdf)], fileName(spec, "score.pdf"), { type: "application/pdf" });
  }

  if (mode === "midi") {
    const beatMap = toMtiJson(recording.timeline, recording.bars.map(bar => bar.beatMapLabel));
    files.midiFile = new File([toMidiFile(recording.timeline)], fileName(spec, "song.mid"), { type: "audio/midi" });
    files.jsonFile = new File([JSON.stringify(beatMap)], fileName(spec, "song.json"), { type: "application/json" });
  }

  if (mode === "audio") {
    files.audioFiles = await buildAudioFiles(recording.timeline, audio);
  }

  return {
    spec,
    timeline,
    recording,
    fields: {
      number: spec.number,
      title: spec.title,
      tracks: buildTracks(timeline, mode),
      score: buildScore(timeline, layouts),
      recording: { spans: buildSpans(recording), warpMarkers: buildWarpMarkers(recording, mode, audio.leadingSilenceSeconds ?? 0) },
      arrangement: buildArrangement(timeline),
    },
    files,
  };
}

/** The ID of the measure printed as `label`. Throws when the score has no such measure. */
export function measureId(score: SongScore, label: string): string {
  const measure = score.measures.find(m => m.label === label);
  if (!measure) {
    throw new Error(`The score has no measure '${label}'.`);
  }

  return measure.id;
}

/** A stored location, written with labels for readability. Occurrence 1 is left out, as the app stores it. */
export function locationAt(score: SongScore, label: string, beat = 0, occurrence = 1): SongLocation {
  return { measure: measureId(score, label), beat, ...(occurrence > 1 ? { occurrence } : {}) };
}

/** The start time of every recorded bar in seconds, in playing order. */
export function recordedBarTimes(bundle: SongBundle, leadingSilenceSeconds = 0): number[] {
  return bundle.recording.timeline.measures.map(m => leadingSilenceSeconds + tickToSeconds(bundle.recording.timeline, m.startTick));
}

/** The score with every box removed, as if no measure had been placed on the PDF yet. */
export function withoutBoxes(score: SongScore): SongScore {
  return { measures: score.measures.map(({ id, label, beats }) => ({ id, label, beats })), unnumberedBoxes: [] };
}
