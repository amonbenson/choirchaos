import { encodeMp3, type Mp3Options, type RenderOptions, renderPartStem } from "./audio";
import { toMidiFile } from "./midi";
import { toMtiJson } from "./mtiJson";
import { loadScoreAssets, type MeasureLayout } from "./score/assets";
import { buildTimeline, terminalMeasureNumber, tickToSeconds, type Timeline } from "./score/timeline";
import type { ScoreSpec, TrackClassification } from "./score/types";

export type SongMode = "midi" | "audio" | "none";

export type SongTrack = {
  title: string;
  classification: TrackClassification;
  program: number;
  /** In a bundle this is the local file name. PocketBase renames uploads, see `createSong()`. */
  audioFile: string;
};

export type SongMeasure = { value: string; beats: number; layout?: MeasureLayout & { review?: boolean } };
export type SongMarker = { type: "marker"; start: [string, number]; marker: string };
export type SongVamp = { type: "vamp"; start: [string, number]; end: [string, number]; iterations: number };
export type SongWarpMarker = { measure: string; time: number };

/** The JSON fields of a `songs` record, in the shape `Song.serialize()` writes. */
export type SongFields = {
  number: string;
  title: string;
  tracks: SongTrack[];
  measures: SongMeasure[];
  events: { markers: SongMarker[]; vamps: SongVamp[]; segue: boolean };
  warpMarkers: SongWarpMarker[];
  unnumberedBoxes?: MeasureLayout[];
};

export type SongFiles = {
  pdfFile?: File;
  midiFile?: File;
  jsonFile?: File;
  audioFiles: File[];
};

export type SongBundle = {
  spec: ScoreSpec;
  timeline: Timeline;
  fields: SongFields;
  files: SongFiles;
};

export type SongBundleOptions = {
  mode: SongMode;
  /** Attach the committed PDF and measure layouts. Requires generated score assets. */
  withPdf?: boolean;
  audio?: RenderOptions & Mp3Options;
};

function fileName(spec: ScoreSpec, suffix: string): string {
  return `${spec.id}-${suffix}`.toLowerCase().replace(/[^a-z0-9.]+/g, "-");
}

function buildMeasures(timeline: Timeline, mode: SongMode, layouts: Map<string, MeasureLayout> | undefined): SongMeasure[] {
  const measures: SongMeasure[] = timeline.measures.map((measure) => {
    const layout = layouts?.get(measure.number);
    return { value: measure.number, beats: measure.beats, ...(layout ? { layout } : {}) };
  });

  if (mode === "midi") {
    const last = timeline.measures[timeline.measures.length - 1]!;
    measures.push({ value: terminalMeasureNumber(timeline), beats: last.beats });
  }

  return measures;
}

function buildEvents(timeline: Timeline): SongFields["events"] {
  const markers: SongMarker[] = timeline.measures
    .filter(measure => measure.rehearsalMark)
    .map(measure => ({ type: "marker", start: [measure.number, 0], marker: measure.rehearsalMark! }));

  const vamps: SongVamp[] = [];
  let vampStart: string | undefined;

  for (const [index, measure] of timeline.measures.entries()) {
    if (measure.vampStart) {
      vampStart = measure.number;
    }

    if (measure.vampEnd && vampStart !== undefined) {
      const following = timeline.measures[index + 1]?.number ?? terminalMeasureNumber(timeline);
      vamps.push({ type: "vamp", start: [vampStart, 0], end: [following, 0], iterations: measure.vampEnd.iterations });
      vampStart = undefined;
    }
  }

  return { markers, vamps, segue: false };
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

function buildWarpMarkers(timeline: Timeline, mode: SongMode, leadingSilenceSeconds: number): SongWarpMarker[] {
  if (mode !== "audio") {
    return [];
  }

  return timeline.measures.map(measure => ({
    measure: measure.number,
    time: leadingSilenceSeconds + tickToSeconds(timeline, measure.startTick),
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
 * MIDI, beat map and audio files. MIDI and audio are generated on the fly; the PDF comes from the
 * committed score assets.
 */
export async function buildSongBundle(spec: ScoreSpec, { mode, withPdf = true, audio = {} }: SongBundleOptions): Promise<SongBundle> {
  const timeline = buildTimeline(spec);
  const assets = withPdf ? loadScoreAssets(spec) : undefined;
  const layouts = assets ? new Map(assets.layout.measures.map(m => [m.number, m.layout])) : undefined;

  const files: SongFiles = { audioFiles: [] };

  if (assets) {
    files.pdfFile = new File([new Uint8Array(assets.pdf)], fileName(spec, "score.pdf"), { type: "application/pdf" });
  }

  if (mode === "midi") {
    files.midiFile = new File([toMidiFile(timeline)], fileName(spec, "song.mid"), { type: "audio/midi" });
    files.jsonFile = new File([JSON.stringify(toMtiJson(timeline))], fileName(spec, "song.json"), { type: "application/json" });
  }

  if (mode === "audio") {
    files.audioFiles = await buildAudioFiles(timeline, audio);
  }

  return {
    spec,
    timeline,
    fields: {
      number: spec.number,
      title: spec.title,
      tracks: buildTracks(timeline, mode),
      measures: buildMeasures(timeline, mode, layouts),
      events: buildEvents(timeline),
      warpMarkers: buildWarpMarkers(timeline, mode, audio.leadingSilenceSeconds ?? 0),
    },
    files,
  };
}
