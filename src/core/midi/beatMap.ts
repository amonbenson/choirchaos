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

export function scoreFromBeatMap(beatMap: MTIMidiJson): BeatMapScore {
  const beatsByLabel = new Map<string, number>();

  for (const event of beatMap.score.events) {
    if (event.type !== "BEAT") {
      continue;
    }

    const { meas, beat } = event.value;
    beatsByLabel.set(meas, Math.max(beatsByLabel.get(meas) ?? 0, beat));
  }

  const measures = Array.from(beatsByLabel, ([label, beats], i) => new Measure(`m${i + 1}`, label, beats));
  const first = measures[0];
  const last = measures.at(-1);
  return { measures, recording: first && last ? [{ from: first.id, to: last.id }] : [] };
}

// The MIDI backend looks up note data by track name, so tracks must carry the exact MIDI names.
export function tracksFromBeatMap(beatMap: MTIMidiJson): Track[] {
  return beatMap.score.trackNames.track.map(({ name }) => new Track(name, inferTrackClassification(name)));
}
