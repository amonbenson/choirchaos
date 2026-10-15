import Measure from "../models/measure";
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

export function measuresFromBeatMap(beatMap: MTIMidiJson): Measure[] {
  const beatsByMeasure = new Map<string, number>();

  for (const event of beatMap.score.events) {
    if (event.type !== "BEAT") {
      continue;
    }

    const { meas, beat } = event.value;
    beatsByMeasure.set(meas, Math.max(beatsByMeasure.get(meas) ?? 0, beat));
  }

  return Array.from(beatsByMeasure, ([value, beats]) => new Measure(value, beats));
}

// The MIDI backend looks up note data by track name, so tracks must carry the exact MIDI names.
export function tracksFromBeatMap(beatMap: MTIMidiJson): Track[] {
  return beatMap.score.trackNames.track.map(({ name }) => new Track(name, inferTrackClassification(name)));
}
