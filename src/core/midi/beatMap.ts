import Measure from "../models/measure";
import type { RecordingSpan } from "../models/recording";
import Track from "../models/track";
import type { MTIMidiJson } from "../scripts/jsonTypes/mti";
import { inferTrackClassification } from "../utils/trackInference";

export function isBeatMap(value: unknown): value is MTIMidiJson {
  const score = (value as MTIMidiJson | undefined)?.score;
  return !!score && Array.isArray(score.events) && Array.isArray(score.trackNames?.track);
}

export async function isBeatMapFile(file: File): Promise<boolean> {
  try {
    return isBeatMap(JSON.parse(await file.text()));
  } catch {
    return false;
  }
}

export type BeatMapScore = {
  measures: Measure[];
  recording: RecordingSpan[];
};

type BeatEvent = Extract<MTIMidiJson["score"]["events"][number], { type: "BEAT" }>;

type BeatMapBar = { label: string; beats: number };

const REPEATED_PASS = /^(.+)-\d+$/;
const REPEAT_MARK = /^(\d+)R+$/;

/** The printed label of a beat map bar: "12-2" and "28A-1" name the bars "12" and "28A", "1R" names "1". */
export function writtenLabel(beatMapLabel: string): string {
  const match = REPEATED_PASS.exec(beatMapLabel) ?? REPEAT_MARK.exec(beatMapLabel);
  return match?.[1] ?? beatMapLabel;
}

function isBeatEvent(event: MTIMidiJson["score"]["events"][number]): event is BeatEvent {
  return event.type === "BEAT";
}

/** The bars in playing order, without the terminal bar that only marks where the last one ends. */
export function readBeatMapBars(beatMap: MTIMidiJson): BeatMapBar[] {
  const beatEvents = beatMap.score.events.filter(isBeatEvent).sort((a, b) => a.tickcount - b.tickcount);
  const bars: BeatMapBar[] = [];

  for (const { value } of beatEvents) {
    const current = bars.at(-1);
    if (current?.label === value.meas) {
      current.beats = Math.max(current.beats, value.beat);
    } else {
      bars.push({ label: value.meas, beats: value.beat });
    }
  }

  return bars.slice(0, -1);
}

function compressToSpans(measures: Measure[], scoreIndices: number[]): RecordingSpan[] {
  const spans: RecordingSpan[] = [];
  let previous = -1;

  for (const index of scoreIndices) {
    const id = measures[index]!.id;
    const current = spans.at(-1);
    if (current && index === previous + 1) {
      current.to = id;
    } else {
      spans.push({ from: id, to: id });
    }

    previous = index;
  }

  return spans;
}

export function scoreFromBeatMap(beatMap: MTIMidiJson): BeatMapScore {
  const measures: Measure[] = [];
  const indexByLabel = new Map<string, number>();
  const scoreIndices: number[] = [];

  for (const bar of readBeatMapBars(beatMap)) {
    const label = writtenLabel(bar.label);
    let index = indexByLabel.get(label);
    if (index === undefined) {
      index = measures.length;
      indexByLabel.set(label, index);
      measures.push(new Measure(`m${index + 1}`, label, bar.beats));
    }

    scoreIndices.push(index);
  }

  return { measures, recording: compressToSpans(measures, scoreIndices) };
}

// The MIDI backend looks up note data by track name, so tracks must carry the exact MIDI names.
export function tracksFromBeatMap(beatMap: MTIMidiJson): Track[] {
  return beatMap.score.trackNames.track.map(({ name }) => new Track(name, inferTrackClassification(name)));
}
