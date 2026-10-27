import { deserializeMarker, type Marker, serializeMarker, type StoredMarker } from "./markers";
import Measure, {
  type MeasureAddition,
  type MeasureEdit,
  type MeasureId,
  type MeasureLayout,
  nextMeasureIds,
  type StoredMeasure,
} from "./measure";
import {
  addMeasureToSpans,
  compareLocations,
  expandRecording,
  findPosition,
  type OccurrenceMap,
  type RecordingSpan,
  remapLocation,
  remapReferences,
  removeMeasureFromSpans,
  type StoredRecording,
  type StoredWarpMarker,
  type Timeline,
  validateLocation,
} from "./recording";
import { compareSections, deserializeSection, type Section, serializeSection, type StoredSection, validateSections } from "./sections";
import { getOccurrenceKey } from "./warpEditing";

export type StoredScore = {
  measures: StoredMeasure[];
  unnumberedBoxes: MeasureLayout[];
};

export type StoredArrangement = {
  markers: StoredMarker[];
  sections: StoredSection[];
  segue: boolean;
};

/** The in-memory form of the three layer fields `score`, `recording` and `arrangement`. */
export type SongLayers = {
  measures: readonly Measure[];
  unnumberedBoxes: readonly MeasureLayout[];
  spans: readonly RecordingSpan[];
  warpMarkers: readonly StoredWarpMarker[];
  markers: readonly Marker[];
  sections: readonly Section[];
  segue: boolean;
};

export type LayerField = keyof SongLayers;

/** The stored form of all three layers, which a save writes and an undo restores. */
export type LayerSnapshot = {
  score: StoredScore;
  recording: StoredRecording;
  arrangement: StoredArrangement;
};

export const EMPTY_LAYERS: LayerSnapshot = Object.freeze({
  score: { measures: [], unnumberedBoxes: [] },
  recording: { spans: [], warpMarkers: [] },
  arrangement: { markers: [], sections: [], segue: false },
}) as LayerSnapshot;

const TIMELINE_FIELDS: readonly LayerField[] = ["measures", "spans"];
const REFERENCE_FIELDS: readonly LayerField[] = ["warpMarkers", "markers", "sections"];

export function serializeScore({ measures, unnumberedBoxes }: Pick<SongLayers, "measures" | "unnumberedBoxes">): StoredScore {
  return { measures: measures.map(measure => measure.serialize()), unnumberedBoxes: [...unnumberedBoxes] };
}

export function serializeRecording({ spans, warpMarkers }: Pick<SongLayers, "spans" | "warpMarkers">): StoredRecording {
  return { spans: spans.map(span => ({ ...span })), warpMarkers: warpMarkers.map(marker => ({ ...marker })) };
}

export function serializeArrangement({ markers, sections, segue }: Pick<SongLayers, "markers" | "sections" | "segue">): StoredArrangement {
  return { markers: markers.map(serializeMarker), sections: sections.map(serializeSection), segue };
}

export function serializeLayers(layers: SongLayers): LayerSnapshot {
  return { score: serializeScore(layers), recording: serializeRecording(layers), arrangement: serializeArrangement(layers) };
}

export function deserializeLayers({ score, recording, arrangement }: LayerSnapshot): SongLayers {
  return {
    measures: score.measures.map(Measure.deserialize),
    unnumberedBoxes: [...score.unnumberedBoxes],
    spans: recording.spans.map(span => ({ ...span })),
    warpMarkers: recording.warpMarkers.map(marker => ({ ...marker })),
    markers: arrangement.markers.map(deserializeMarker),
    sections: arrangement.sections.map(deserializeSection),
    segue: arrangement.segue,
  };
}

export function isSameSnapshot(a: LayerSnapshot, b: LayerSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function serializeField(layers: SongLayers, field: LayerField): unknown {
  switch (field) {
    case "measures":
      return layers.measures.map(measure => measure.serialize());
    case "markers":
      return layers.markers.map(serializeMarker);
    case "sections":
      return layers.sections.map(serializeSection);
    default:
      return layers[field];
  }
}

/** The fields whose stored form differs between the two layers. */
export function getChangedFields(before: SongLayers, after: SongLayers): Set<LayerField> {
  const fields = Object.keys(before) as LayerField[];
  return new Set(fields.filter(field => JSON.stringify(serializeField(before, field)) !== JSON.stringify(serializeField(after, field))));
}

function getTimingKey({ measures, spans }: SongLayers): string {
  return JSON.stringify([measures.map(measure => [measure.id, measure.beats]), spans]);
}

/** Labels and boxes are not part of the timeline, so only the measure order, beats and recording time the song. */
export function changesTiming(before: SongLayers, after: SongLayers): boolean {
  return getTimingKey(before) !== getTimingKey(after);
}

/** Puts warp markers, markers and sections in timeline order, as the panels list them. */
export function sortReferences(layers: SongLayers): SongLayers {
  const timeline = expandRecording(layers.measures, layers.spans);
  const position = (marker: StoredWarpMarker): number => findPosition(timeline, marker) ?? Infinity;
  return {
    ...layers,
    warpMarkers: [...layers.warpMarkers].sort((a, b) => position(a) - position(b)),
    markers: [...layers.markers].sort((a, b) => compareLocations(timeline, a.at, b.at)),
    sections: [...layers.sections].sort((a, b) => compareSections(timeline, a, b)),
  };
}

function validateMeasures(measures: readonly Measure[]): string | undefined {
  const ids = measures.map(measure => measure.id);
  if (new Set(ids).size !== ids.length) {
    return "Measure IDs must be unique.";
  }

  if (measures.some(measure => !Number.isInteger(measure.beats) || measure.beats < 1)) {
    return "Measures need a positive whole number of beats.";
  }

  const labels = measures.map(measure => measure.label);
  if (labels.some(label => label.trim() === "")) {
    return "Measure labels must not be empty.";
  }

  const duplicate = labels.find((label, i) => labels.indexOf(label) !== i);
  return duplicate === undefined ? undefined : `Measure ${duplicate} exists twice.`;
}

function validateTimeline({ measures, spans }: SongLayers): string | undefined {
  try {
    expandRecording(measures, spans);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function validateWarpMarkers(measures: readonly Measure[], timeline: Timeline, warpMarkers: readonly StoredWarpMarker[]): string | undefined {
  const label = (id: MeasureId): string => measures.find(measure => measure.id === id)?.label ?? id;
  const unplayed = warpMarkers.find(marker => findPosition(timeline, marker) === undefined);
  if (unplayed) {
    return `Measure ${label(unplayed.measure)} is not played ${unplayed.occurrence} times.`;
  }

  const keys = warpMarkers.map(getOccurrenceKey);
  const duplicate = warpMarkers.find((_, i) => keys.indexOf(keys[i]!) !== i);
  return duplicate && `Measure ${label(duplicate.measure)} already has a sync point.`;
}

function validateReference(layers: SongLayers, timeline: Timeline, field: LayerField): string | undefined {
  switch (field) {
    case "warpMarkers":
      return validateWarpMarkers(layers.measures, timeline, layers.warpMarkers);
    case "markers":
      return layers.markers.map(marker => validateLocation(layers.measures, timeline, marker.at)).find(Boolean);
    case "sections":
      return validateSections(layers.measures, timeline, layers.sections)[0]?.reason;
    default:
      return undefined;
  }
}

/**
 * Why the layers cannot be saved, or undefined when they can. Only the given fields are checked, so data
 * that was stored before a rule existed never blocks other edits, but a new timeline checks every reference.
 */
export function validateLayers(layers: SongLayers, fields: ReadonlySet<LayerField>): string | undefined {
  const timelineChanged = TIMELINE_FIELDS.some(field => fields.has(field));
  const measureError = timelineChanged ? validateMeasures(layers.measures) ?? validateTimeline(layers) : undefined;
  if (measureError) {
    return measureError;
  }

  const timeline = expandRecording(layers.measures, layers.spans);
  const checked = REFERENCE_FIELDS.filter(field => timelineChanged || fields.has(field));
  return checked.map(field => validateReference(layers, timeline, field)).find(Boolean);
}

/** Drops every warp marker, marker and section that no longer resolves after the measures changed. */
export function dropUnresolvedReferences(layers: SongLayers): SongLayers {
  const timeline = expandRecording(layers.measures, layers.spans);
  const invalid = new Set(validateSections(layers.measures, timeline, layers.sections).map(issue => issue.index));
  return {
    ...layers,
    warpMarkers: layers.warpMarkers.filter(marker => findPosition(timeline, marker) !== undefined),
    markers: layers.markers.filter(marker => !validateLocation(layers.measures, timeline, marker.at)),
    sections: layers.sections.filter((_, index) => !invalid.has(index)),
  };
}

// Measure edits

export type PlannedMeasureEdit = {
  layers: SongLayers;
  /** The added measures, in the order of `edit.additions`. */
  added: Measure[];
};

function assertKnownMeasures(measures: readonly Measure[], edit: MeasureEdit): void {
  const known = new Set(measures.map(measure => measure.id));
  const referenced = [...edit.removals, ...edit.relabels.keys(), ...edit.layouts.keys(), ...edit.beats.keys()];
  const unknown = referenced.find(id => !known.has(id));
  if (unknown) {
    throw new Error(`Measure ${unknown} does not exist.`);
  }
}

function editMeasure(measure: Measure, edit: MeasureEdit): Measure {
  const { id } = measure;
  if (!edit.relabels.has(id) && !edit.layouts.has(id) && !edit.beats.has(id)) {
    return measure;
  }

  const layout = edit.layouts.has(id) ? edit.layouts.get(id) : measure.layout;
  return new Measure(id, edit.relabels.get(id) ?? measure.label, edit.beats.get(id) ?? measure.beats, layout);
}

function addMeasures(layers: SongLayers, additions: readonly MeasureAddition[], ids: readonly MeasureId[]): { measures: Measure[]; spans: RecordingSpan[]; added: Measure[] } {
  const measures = [...layers.measures];
  let spans = [...layers.spans];
  const added = additions.map((addition, i) => new Measure(ids[i]!, addition.label, addition.beats, addition.layout));
  const ordered = additions.map((addition, i) => ({ index: addition.index, measure: added[i]! })).sort((a, b) => a.index - b.index);

  for (const { index, measure } of ordered) {
    measures.splice(Math.max(0, Math.min(index, measures.length)), 0, measure);
    spans = addMeasureToSpans(spans, measures.map(other => other.id), measure.id);
  }

  return { measures, spans, added };
}

/**
 * The layers after a measure edit. Removed measures take their warp markers, markers and sections
 * along, and the recording follows added and removed measures.
 */
export function planMeasureEdit(layers: SongLayers, edit: MeasureEdit): PlannedMeasureEdit {
  assertKnownMeasures(layers.measures, edit);
  let spans = [...layers.spans];
  let score = layers.measures.map(measure => measure.id);
  for (const id of edit.removals) {
    spans = removeMeasureFromSpans(spans, score, id);
    score = score.filter(other => other !== id);
  }

  const removed = new Set(edit.removals);
  const kept = layers.measures.filter(measure => !removed.has(measure.id)).map(measure => editMeasure(measure, edit));
  const remaining = { ...layers, measures: kept, spans };
  const result = addMeasures(remaining, edit.additions, nextMeasureIds(layers.measures, edit.additions.length));
  const next = {
    ...remaining,
    measures: result.measures,
    spans: result.spans,
    unnumberedBoxes: edit.unnumberedBoxes ?? layers.unnumberedBoxes,
  };

  return { layers: changesTiming(layers, next) ? dropUnresolvedReferences(next) : next, added: result.added };
}

// Recording changes

/** References a recording change cannot move, as they are before the change. */
export type DroppedReferences = {
  warpMarkers: StoredWarpMarker[];
  markers: Marker[];
  sections: Section[];
};

/** What a recording change will do, shown before it is saved. */
export type RecordingPreview = {
  spans: RecordingSpan[];
  /** How many measures the recording plays afterwards. */
  length: number;
  dropped: DroppedReferences;
};

export type RecordingChange = {
  layers: SongLayers;
  dropped: DroppedReferences;
};

/** Sections whose ends both move and that still validate, for example without overlapping, in timeline order. */
function remapSections(sections: readonly Section[], map: OccurrenceMap, measures: readonly Measure[], timeline: Timeline, dropped: DroppedReferences): Section[] {
  const moved = sections.flatMap((original) => {
    const from = remapLocation(map, original.from);
    const to = remapLocation(map, original.to);
    return from && to ? [{ original, section: { ...original, from, to } }] : [];
  });
  moved.sort((a, b) => compareSections(timeline, a.section, b.section));

  const invalid = new Set(validateSections(measures, timeline, moved.map(({ section }) => section)).map(issue => issue.index));
  const kept = moved.filter((_, index) => !invalid.has(index));
  dropped.sections.push(...sections.filter(section => !kept.some(({ original }) => original === section)));
  return kept.map(({ section }) => section);
}

/**
 * The layers after the recording changes to `spans` over `measures`. Warp markers keep their times, and
 * they, markers and sections move with their timeline position wherever it survives the change. Only the
 * rest are dropped. `replacements` let references on a removed measure move to another measure.
 */
export function planRecordingChange(
  layers: SongLayers,
  measures: readonly Measure[],
  spans: readonly RecordingSpan[],
  replacements?: ReadonlyMap<MeasureId, MeasureId>,
): RecordingChange {
  const before = expandRecording(layers.measures, layers.spans);
  const timeline = expandRecording(measures, spans);
  const map = remapReferences(before, timeline, replacements);
  const dropped: DroppedReferences = { warpMarkers: [], markers: [], sections: [] };

  const warpMarkers = layers.warpMarkers.flatMap((marker) => {
    const moved = map(marker);
    if (!moved) {
      dropped.warpMarkers.push(marker);
      return [];
    }

    return [{ ...moved, time: marker.time }];
  });

  const markers = layers.markers.flatMap((marker) => {
    const at = remapLocation(map, marker.at);
    if (!at || validateLocation(measures, timeline, at)) {
      dropped.markers.push(marker);
      return [];
    }

    return [{ at, text: marker.text }];
  });

  return {
    layers: {
      ...layers,
      measures: [...measures],
      spans: spans.map(span => ({ ...span })),
      warpMarkers,
      markers,
      sections: remapSections(layers.sections, map, measures, timeline, dropped),
    },
    dropped,
  };
}

export function toRecordingPreview({ layers, dropped }: RecordingChange): RecordingPreview {
  return { spans: [...layers.spans], length: expandRecording(layers.measures, layers.spans).length, dropped };
}
