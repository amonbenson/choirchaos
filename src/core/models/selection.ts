import type { Marker } from "./markers";
import type Measure from "./measure";
import { isSameLayout, type MeasureId, type MeasureLayout } from "./measure";
import { getReadingOrder } from "./measureEditing";
import {
  getRecordingStretches,
  type Location,
  type RecordedPass,
  type RecordingStretch,
  type Timeline,
} from "./recording";
import { findSection, type Section } from "./sections";
import type Song from "./song";
import { getSyncTime, type SyncPlace } from "./warpEditing";

/**
 * What the song editor works on. Exactly one kind is selected at a time, so the inspector shows one
 * panel and a section is never selected together with its measures. Each object is kept by what
 * identifies it across saves: measures by ID, boxes without a number by position, a section by its
 * start (sections never overlap), a marker by its location and name, a sync point by its place
 * and a recording pass by its index in the recording.
 */
export type Selection
  = | { kind: "none" }
    | { kind: "measures"; ids: readonly MeasureId[]; anchor: MeasureId }
    | { kind: "boxes"; boxes: readonly MeasureLayout[] }
    | { kind: "section"; from: Location }
    | { kind: "marker"; marker: Marker }
    | { kind: "syncPoint"; place: SyncPlace }
    | { kind: "pass"; index: number };

/** A selection with its objects looked up in the song. Objects that no longer exist leave nothing selected. */
export type SelectedObjects
  = | { kind: "none" }
    | { kind: "measures"; measures: Measure[] }
    | { kind: "boxes"; boxes: MeasureLayout[] }
    | { kind: "section"; section: Section }
    | { kind: "marker"; marker: Marker }
    | { kind: "syncPoint"; place: SyncPlace; time: number }
    | { kind: "pass"; index: number; stretch: RecordingStretch };

export const NO_SELECTION = { kind: "none" } as const;

export function selectMeasures(ids: readonly MeasureId[], anchor: MeasureId | undefined = ids.at(-1)): Selection {
  return ids.length > 0 && anchor ? { kind: "measures", ids: [...ids], anchor } : NO_SELECTION;
}

export function isMeasureSelected(selection: Selection, id: MeasureId): boolean {
  return selection.kind === "measures" && selection.ids.includes(id);
}

export function isBoxSelected(selection: Selection, box: MeasureLayout): boolean {
  return selection.kind === "boxes" && selection.boxes.some(other => isSameLayout(other, box));
}

export function isMarkerSelected(selection: Selection, marker: Marker): boolean {
  return selection.kind === "marker" && isSameMarker(selection.marker, marker);
}

export function isSectionSelected(selection: Selection, section: Section): boolean {
  return selection.kind === "section" && findSection([section], selection.from) !== undefined;
}

export function isPassSelected(selection: Selection, index: number): boolean {
  return selection.kind === "pass" && selection.index === index;
}

/** Adds or removes a measure. Toggling measures into another kind of selection starts a new one. */
export function toggleMeasure(selection: Selection, id: MeasureId): Selection {
  if (selection.kind !== "measures") {
    return selectMeasures([id]);
  }

  const ids = selection.ids.includes(id) ? selection.ids.filter(other => other !== id) : [...selection.ids, id];
  return selectMeasures(ids, id);
}

/**
 * The measures a user can select, in the order a range walks them. A song with a score shows its
 * measures as boxes, read in reading order. A song without one shows every measure in score order.
 */
export function getSelectableMeasures(song: Song): Measure[] {
  return song.pdfFile ? getReadingOrder(song.getMeasures()) : [...song.getMeasures()];
}

/** Every selectable measure from the anchor to `id`. Without measures selected it selects `id` alone. */
export function selectMeasureRange(selectable: readonly Measure[], selection: Selection, id: MeasureId): Selection {
  if (selection.kind !== "measures") {
    return selectMeasures([id]);
  }

  const a = selectable.findIndex(measure => measure.id === selection.anchor);
  const b = selectable.findIndex(measure => measure.id === id);
  if (a === -1 || b === -1) {
    return selectMeasures([id]);
  }

  const range = selectable.slice(Math.min(a, b), Math.max(a, b) + 1).map(measure => measure.id);
  return selectMeasures(range, selection.anchor);
}

export function toggleBox(selection: Selection, box: MeasureLayout): Selection {
  if (selection.kind !== "boxes") {
    return { kind: "boxes", boxes: [box] };
  }

  const boxes = isBoxSelected(selection, box)
    ? selection.boxes.filter(other => !isSameLayout(other, box))
    : [...selection.boxes, box];
  return boxes.length > 0 ? { kind: "boxes", boxes } : NO_SELECTION;
}

export function isSameMarker(a: Marker, b: Marker): boolean {
  return a.text === b.text && a.at.measure === b.at.measure && a.at.occurrence === b.at.occurrence && a.at.beat === b.at.beat;
}

function resolveMeasures(song: Song, ids: readonly MeasureId[]): SelectedObjects {
  const measures = getSelectableMeasures(song).filter(measure => ids.includes(measure.id));
  return measures.length > 0 ? { kind: "measures", measures } : NO_SELECTION;
}

function resolveBoxes(song: Song, boxes: readonly MeasureLayout[]): SelectedObjects {
  const existing = song.getUnnumberedBoxes().filter(box => boxes.some(other => isSameLayout(box, other)));
  return existing.length > 0 ? { kind: "boxes", boxes: existing } : NO_SELECTION;
}

function found<T>(value: T | undefined, select: (value: T) => SelectedObjects): SelectedObjects {
  return value === undefined ? NO_SELECTION : select(value);
}

export function resolveSelection(song: Song, selection: Selection): SelectedObjects {
  switch (selection.kind) {
    case "none":
      return NO_SELECTION;
    case "measures":
      return resolveMeasures(song, selection.ids);
    case "boxes":
      return resolveBoxes(song, selection.boxes);
    case "section":
      return found(findSection(song.getSections(), selection.from), section => ({ kind: "section", section }));
    case "marker":
      return found(song.getMarkers().find(marker => isSameMarker(marker, selection.marker)), marker => ({ kind: "marker", marker }));
    case "syncPoint":
      return found(getSyncTime(song.getSyncPoints(), selection.place), time => ({ kind: "syncPoint", place: selection.place, time }));
    case "pass":
      return found(
        getRecordingStretches(song.getMeasures(), song.getRecording())[selection.index],
        stretch => ({ kind: "pass", index: selection.index, stretch }),
      );
  }
}

/**
 * Every place where the recording plays exactly these measures, in score order and back to back.
 * Measures that never play like that are not consecutive and have no runs.
 */
export function findMeasureRuns(measures: readonly Measure[], timeline: Timeline, ids: readonly MeasureId[]): RecordedPass[] {
  const ordered = measures.filter(measure => ids.includes(measure.id)).map(measure => measure.id);
  if (ordered.length === 0 || ordered.length !== new Set(ids).size) {
    return [];
  }

  return timeline
    .filter(({ position }) => ordered.every((id, offset) => timeline[position + offset]?.measure === id))
    .map(({ position }) => ({ first: position, last: position + ordered.length - 1 }));
}

function distanceTo(run: RecordedPass, position: number): number {
  if (position < run.first) {
    return run.first - position;
  }

  return position > run.last ? position - run.last : 0;
}

/** The run the playhead is in, or the one closest to it, so the selected measures follow the playhead. */
export function pickRun(runs: readonly RecordedPass[], playhead: number | undefined): RecordedPass | undefined {
  if (playhead === undefined) {
    return runs[0];
  }

  return runs.reduce<RecordedPass | undefined>((best, run) => !best || distanceTo(run, playhead) < distanceTo(best, playhead) ? run : best, undefined);
}
