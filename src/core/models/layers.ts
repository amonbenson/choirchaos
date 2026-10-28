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
  /** Where the recording's last measure ends, in seconds, or undefined while the end is not synced. */
  endSyncTime: number | undefined;
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
const REFERENCE_FIELDS: readonly LayerField[] = ["warpMarkers", "endSyncTime", "markers", "sections"];

export function serializeScore({ measures, unnumberedBoxes }: Pick<SongLayers, "measures" | "unnumberedBoxes">): StoredScore {
  return { measures: measures.map(measure => measure.serialize()), unnumberedBoxes: [...unnumberedBoxes] };
}

export function serializeRecording({ spans, warpMarkers, endSyncTime }: Pick<SongLayers, "spans" | "warpMarkers" | "endSyncTime">): StoredRecording {
  const recording = { spans: spans.map(span => ({ ...span })), warpMarkers: warpMarkers.map(marker => ({ ...marker })) };
  return endSyncTime === undefined ? recording : { ...recording, endSyncTime };
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
    endSyncTime: recording.endSyncTime,
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

function validateEndSyncTime(timeline: Timeline, { warpMarkers, endSyncTime }: SongLayers): string | undefined {
  if (endSyncTime === undefined) {
    return undefined;
  }

  if (timeline.length === 0) {
    return "The recording plays no measures whose end could be synced.";
  }

  if (!Number.isFinite(endSyncTime) || endSyncTime <= 0) {
    return "The end of the recording needs a time after its start.";
  }

  const later = warpMarkers.some(marker => findPosition(timeline, marker) !== undefined && marker.time >= endSyncTime);
  return later ? "The end of the recording must be synced after every other sync point." : undefined;
}

function validateReference(layers: SongLayers, timeline: Timeline, field: LayerField): string | undefined {
  switch (field) {
    case "warpMarkers":
      return validateWarpMarkers(layers.measures, timeline, layers.warpMarkers);
    case "endSyncTime":
      return validateEndSyncTime(timeline, layers);
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
    endSyncTime: timeline.length > 0 ? layers.endSyncTime : undefined,
    markers: layers.markers.filter(marker => !validateLocation(layers.measures, timeline, marker.at)),
    sections: layers.sections.filter((_, index) => !invalid.has(index)),
  };
}

/**
 * The sync points once the timeline changed from `before` to `after`. The end sync point stays while the
 * last measure of `before` still ends the recording, and becomes the warp marker of the measure after it
 * once the recording plays on. Without that measure in `after`, it is dropped (`endSyncTime` undefined).
 */
function remapEndSync(
  { warpMarkers, endSyncTime }: Pick<SongLayers, "warpMarkers" | "endSyncTime">,
  before: Timeline,
  after: Timeline,
  map: OccurrenceMap,
): Pick<SongLayers, "warpMarkers" | "endSyncTime"> {
  const last = before.at(-1);
  const moved = endSyncTime === undefined || !last ? undefined : map(last);
  const position = moved && findPosition(after, moved);
  if (endSyncTime === undefined || position === undefined) {
    return { warpMarkers, endSyncTime: undefined };
  }

  const next = after[position + 1];
  if (!next) {
    return { warpMarkers, endSyncTime };
  }

  return { warpMarkers: [...warpMarkers, { measure: next.measure, occurrence: next.occurrence, time: endSyncTime }], endSyncTime: undefined };
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

  if (!changesTiming(layers, next)) {
    return { layers: next, added: result.added };
  }

  // Measure IDs stay, so every occurrence the new timeline still plays keeps its place.
  const resolved = dropUnresolvedReferences(next);
  const after = expandRecording(resolved.measures, resolved.spans);
  const sameOccurrence: OccurrenceMap = occurrence => findPosition(after, occurrence) === undefined ? undefined : occurrence;
  const sync = remapEndSync({ ...resolved, endSyncTime: layers.endSyncTime }, expandRecording(layers.measures, layers.spans), after, sameOccurrence);
  return { layers: { ...resolved, ...sync }, added: result.added };
}

// Recording changes

/** References a recording change cannot move, as they are before the change. */
export type DroppedReferences = {
  warpMarkers: StoredWarpMarker[];
  /** The time of a dropped end sync point. */
  endSyncTime?: number;
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
 * rest are dropped. The end sync point follows the last measure (`remapEndSync()`). `replacements` let
 * references on a removed measure move to another measure.
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

  const sync = remapEndSync({ warpMarkers, endSyncTime: layers.endSyncTime }, before, timeline, map);
  if (layers.endSyncTime !== undefined && sync.warpMarkers === warpMarkers && sync.endSyncTime === undefined) {
    dropped.endSyncTime = layers.endSyncTime;
  }

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
      ...sync,
      markers,
      sections: remapSections(layers.sections, map, measures, timeline, dropped),
    },
    dropped,
  };
}

export function toRecordingPreview({ layers, dropped }: RecordingChange): RecordingPreview {
  return { spans: [...layers.spans], length: expandRecording(layers.measures, layers.spans).length, dropped };
}
