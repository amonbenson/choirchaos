/**
 * Only exists to migrate old songs, which faked a repeat with extra measures whose boxes lie exactly on
 * the boxes of earlier measures. It proposes to play such duplicates as another pass of the originals.
 * Once no stored song has duplicates left, delete this file, `DuplicateReviewCard.vue` and its line in
 * `SetupOverview.vue`.
 */
import { planRecordingChange, type RecordingChange, type RecordingPreview, type SongLayers, toRecordingPreview } from "./layers";
import Measure, { isSameLayout, type MeasureId } from "./measure";
import { expandRecording, spansFromSequence } from "./recording";
import type Song from "./song";

/** Consecutive measures on top of other consecutive measures earlier in the score. The i-th duplicate lies on the i-th original. */
export type DuplicateRun = {
  duplicates: Measure[];
  originals: Measure[];
};

function findOriginal(measures: readonly Measure[], index: number): number {
  const layout = measures[index]!.layout;
  return layout ? measures.findIndex((other, i) => i < index && other.layout && isSameLayout(other.layout, layout)) : -1;
}

function continuesRun(measures: readonly Measure[], run: DuplicateRun | undefined, index: number, original: number): boolean {
  return run !== undefined && run.duplicates.at(-1) === measures[index - 1] && run.originals.at(-1) === measures[original - 1];
}

export function findDuplicateRuns(measures: readonly Measure[]): DuplicateRun[] {
  const runs: DuplicateRun[] = [];

  measures.forEach((measure, index) => {
    const original = findOriginal(measures, index);
    if (original === -1) {
      return;
    }

    const run = runs.at(-1);
    if (continuesRun(measures, run, index, original)) {
      run!.duplicates.push(measure);
      run!.originals.push(measures[original]!);
    } else {
      runs.push({ duplicates: [measure], originals: [measures[original]!] });
    }
  });

  return runs;
}

function assertPairs(layers: SongLayers, duplicates: readonly MeasureId[], originals: readonly MeasureId[]): void {
  if (duplicates.length === 0 || duplicates.length !== originals.length) {
    throw new Error("Every duplicate needs exactly one original.");
  }

  const known = new Set(layers.measures.map(measure => measure.id));
  const unknown = [...duplicates, ...originals].find(id => !known.has(id));
  if (unknown) {
    throw new Error(`Measure ${unknown} does not exist.`);
  }

  const removed = new Set(duplicates);
  if (removed.size !== duplicates.length || originals.some(id => removed.has(id))) {
    throw new Error("A measure cannot be both a duplicate and an original.");
  }
}

/** An original without a box takes the box of its duplicate, so the score still shows the measure. */
function keepOriginals(layers: SongLayers, replacements: ReadonlyMap<MeasureId, MeasureId>): Measure[] {
  const boxes = new Map([...replacements].map(([duplicate, original]) => [original, layers.measures.find(measure => measure.id === duplicate)!.layout]));
  return layers.measures
    .filter(measure => !replacements.has(measure.id))
    .map(measure => measure.layout || !boxes.get(measure.id) ? measure : new Measure(measure.id, measure.label, measure.beats, boxes.get(measure.id)));
}

/**
 * The recording plays the i-th original wherever it played the i-th duplicate, every reference on a
 * duplicate moves to that occurrence of its original, and the duplicates are deleted. Timeline positions
 * stay the same, so the audio sync does not change.
 */
export function planDuplicatesAsRepeat(layers: SongLayers, duplicates: readonly MeasureId[], originals: readonly MeasureId[]): RecordingChange {
  assertPairs(layers, duplicates, originals);
  const replacements = new Map(duplicates.map((id, i) => [id, originals[i]!]));
  const measures = keepOriginals(layers, replacements);
  const sequence = expandRecording(layers.measures, layers.spans).map(entry => replacements.get(entry.measure) ?? entry.measure);
  const spans = spansFromSequence(measures.map(measure => measure.id), sequence);
  return planRecordingChange(layers, measures, spans, replacements);
}

export function previewDuplicatesAsRepeat(song: Song, duplicates: readonly MeasureId[], originals: readonly MeasureId[]): RecordingPreview {
  return toRecordingPreview(planDuplicatesAsRepeat(song.getLayers(), duplicates, originals));
}

/** Saves all three layers in one request. */
export async function playDuplicatesAsRepeat(song: Song, duplicates: readonly MeasureId[], originals: readonly MeasureId[]): Promise<void> {
  await song.editLayers(planDuplicatesAsRepeat(song.getLayers(), duplicates, originals).layers);
}
