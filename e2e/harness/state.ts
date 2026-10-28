import type PocketBase from "pocketbase";
import type { CollectionModel, RecordModel } from "pocketbase";

export type BackendSnapshot = {
  collections: CollectionModel[];
  records: Record<string, RecordModel[]>;
};

export type SnapshotOptions = {
  /** Fields removed from every record, e.g. `["updated"]` to compare states across writes. */
  omitFields?: string[];
};

export type InvariantContext = {
  admin: PocketBase;
  snapshot: BackendSnapshot;
};

export type Invariant = {
  name: string;
  /** Returns one human readable message per violation. */
  check: (context: InvariantContext) => Promise<string[]> | string[];
};

export async function listAppCollections(admin: PocketBase): Promise<CollectionModel[]> {
  const collections = await admin.collections.getFullList();
  return collections.filter(collection => !collection.system && collection.type !== "view");
}

/**
 * Orders collections so that every collection comes before the collections it references.
 * Deleting in this order never trips over required relations.
 */
function deletionOrder(collections: CollectionModel[]): CollectionModel[] {
  const referencedIds = (collection: CollectionModel): string[] => collection.fields
    .filter(field => field.type === "relation" && field.collectionId !== collection.id)
    .map(field => field.collectionId as string);

  const remaining = [...collections];
  const ordered: CollectionModel[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex(candidate =>
      !remaining.some(other => other !== candidate && referencedIds(other).includes(candidate.id)));
    const next = remaining.splice(index === -1 ? 0 : index, 1)[0]!;
    ordered.push(next);
  }

  return ordered;
}

/** Deletes every record of every app collection. The schema and superusers stay. */
export async function resetBackend(admin: PocketBase): Promise<void> {
  for (const collection of deletionOrder(await listAppCollections(admin))) {
    await admin.collections.truncate(collection.name);
  }
}

export async function snapshotBackend(admin: PocketBase, { omitFields = [] }: SnapshotOptions = {}): Promise<BackendSnapshot> {
  const collections = await listAppCollections(admin);
  const records: Record<string, RecordModel[]> = {};

  for (const collection of collections) {
    const items = await admin.collection(collection.name).getFullList({ sort: "id" });
    records[collection.name] = items.map((item) => {
      const copy: RecordModel = { ...item };
      omitFields.forEach(field => delete copy[field]);
      return copy;
    });
  }

  return { collections, records };
}

function asArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter(item => typeof item === "string" && item !== "");
  }

  return typeof value === "string" && value !== "" ? [value] : [];
}

const relationsResolve: Invariant = {
  name: "relations resolve",
  check: ({ snapshot }) => {
    const idsByCollection = new Map(snapshot.collections.map(c => [c.id, new Set((snapshot.records[c.name] ?? []).map(r => r.id))]));
    const violations: string[] = [];

    for (const collection of snapshot.collections) {
      for (const field of collection.fields.filter(f => f.type === "relation")) {
        const targetIds = idsByCollection.get(field.collectionId as string);
        if (!targetIds) {
          continue;
        }

        for (const record of snapshot.records[collection.name] ?? []) {
          const missing = asArray(record[field.name]).filter(id => !targetIds.has(id));
          missing.forEach(id => violations.push(`${collection.name}/${record.id}.${field.name} points to missing record '${id}'`));
        }
      }
    }

    return violations;
  },
};

const filesDownloadable: Invariant = {
  name: "referenced files are downloadable",
  check: async ({ admin, snapshot }) => {
    const violations: string[] = [];

    for (const collection of snapshot.collections) {
      const fileFields = collection.fields.filter(f => f.type === "file");

      for (const record of snapshot.records[collection.name] ?? []) {
        for (const field of fileFields) {
          for (const filename of asArray(record[field.name])) {
            const response = await fetch(admin.files.getURL(record, filename), { method: "HEAD" });
            if (!response.ok) {
              violations.push(`${collection.name}/${record.id}.${field.name}: '${filename}' returns HTTP ${response.status}`);
            }
          }
        }
      }
    }

    return violations;
  },
};

type Json = Record<string, unknown>;

const LAYER_KEYS = {
  score: ["measures", "unnumberedBoxes"],
  recording: ["spans", "warpMarkers"],
  arrangement: ["markers", "sections", "segue"],
} as const;

const OPTIONAL_LAYER_KEYS: Record<string, string[]> = { recording: ["endSyncTime"] };

const LAYOUT_KEYS = ["page", "x", "y", "width", "height"];
const SECTION_KEYS: Record<string, string[]> = {
  cut: ["kind", "from", "to"],
  repeat: ["kind", "from", "to", "passes"],
  vamp: ["kind", "from", "to", "out", "vocals"],
};

const VAMP_OUTS = ["onEnd", "anyBar", "anyBeat"];
const VAMP_VOCALS = ["all", "first", "last", "split"];

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasKeys(value: Json, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every(key => keys.includes(key)) && keys.every(key => required.includes(key) || optional.includes(key));
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isLayout(value: unknown): boolean {
  if (!isObject(value) || !hasKeys(value, LAYOUT_KEYS, ["review"])) {
    return false;
  }

  const { page, x, y, width, height, review } = value;
  return Number.isInteger(page) && (page as number) >= 0
    && [x, y, width, height].every(fraction => typeof fraction === "number" && fraction >= 0 && fraction <= 1)
    && (width as number) > 0 && (height as number) > 0
    && ["boolean", "undefined"].includes(typeof review);
}

type TimelineEntry = { measure: string; occurrence: number };

type StoredMeasure = { id: string; label: string; beats: number; layout?: unknown };

/** The lists of a song's layers once their shape is checked. */
type Layers = {
  measures: StoredMeasure[];
  unnumberedBoxes: unknown[];
  spans: Json[];
  warpMarkers: Json[];
  endSyncTime?: unknown;
  markers: Json[];
  sections: Json[];
};

function layerShapeViolations(song: RecordModel): string[] {
  const violations: string[] = [];

  if (!Array.isArray(song.tracks)) {
    violations.push("tracks is not an array");
  }

  for (const [layer, keys] of Object.entries(LAYER_KEYS)) {
    if (!isObject(song[layer]) || !hasKeys(song[layer], keys, OPTIONAL_LAYER_KEYS[layer])) {
      violations.push(`${layer} is not an object with exactly the keys ${keys.join(", ")}`);
    }
  }

  if (violations.length > 0) {
    return violations;
  }

  for (const [layer, keys] of Object.entries(LAYER_KEYS)) {
    keys.filter(key => key !== "segue" && !(Array.isArray(song[layer][key]) && song[layer][key].every(isObject)))
      .forEach(key => violations.push(`${layer}.${key} is not an array of objects`));
  }

  if (typeof song.arrangement.segue !== "boolean") {
    violations.push("arrangement.segue is not a boolean");
  }

  return violations;
}

function measureViolations({ measures, unnumberedBoxes }: Layers): string[] {
  const violations: string[] = [];
  const ids = new Set<string>();
  const labels = new Set<string>();

  for (const measure of measures) {
    const name = `measure ${JSON.stringify(measure.label)} (${measure.id})`;

    if (!hasKeys(measure, ["id", "label", "beats"], ["layout"])) {
      violations.push(`${name} has the keys ${Object.keys(measure).join(", ")}`);
    }

    if (typeof measure.id !== "string" || ids.has(measure.id)) {
      violations.push(`${name} has a missing or duplicate ID`);
    }

    if (typeof measure.label !== "string" || measure.label === "" || labels.has(measure.label)) {
      violations.push(`${name} has an empty or duplicate label`);
    }

    if (!isPositiveInteger(measure.beats)) {
      violations.push(`${name} has ${measure.beats} beats`);
    }

    if (measure.layout !== undefined && !isLayout(measure.layout)) {
      violations.push(`${name} has a malformed layout ${JSON.stringify(measure.layout)}`);
    }

    ids.add(measure.id);
    labels.add(measure.label);
  }

  unnumberedBoxes.filter(box => !isLayout(box)).forEach(box => violations.push(`unnumbered box ${JSON.stringify(box)} is malformed`));
  return violations;
}

/** Expands the spans into one entry per measure played, like `expandRecording()` in the app. */
function expandSpans({ measures, spans }: Layers, violations: string[]): TimelineEntry[] {
  const indices = new Map(measures.map((measure, index) => [measure.id, index]));
  const occurrences = new Map<string, number>();
  const timeline: TimelineEntry[] = [];

  if (measures.length > 0 && spans.length === 0) {
    violations.push("has measures but no recording spans");
  }

  for (const span of spans) {
    const first = indices.get(span.from as string);
    const last = indices.get(span.to as string);
    if (!hasKeys(span, ["from", "to"]) || first === undefined || last === undefined || first > last) {
      violations.push(`recording span ${JSON.stringify(span)} does not cover existing measures in score order`);
      continue;
    }

    for (let index = first; index <= last; index++) {
      const measure = measures[index]!.id;
      const occurrence = (occurrences.get(measure) ?? 0) + 1;
      occurrences.set(measure, occurrence);
      timeline.push({ measure, occurrence });
    }
  }

  return timeline;
}

function findPosition(timeline: TimelineEntry[], measure: unknown, occurrence: unknown): number | undefined {
  const index = timeline.findIndex(entry => entry.measure === measure && entry.occurrence === occurrence);
  return index === -1 ? undefined : index;
}

function warpMarkerViolations(song: RecordModel, { warpMarkers, endSyncTime }: Layers, timeline: TimelineEntry[]): string[] {
  if (song.midiFile && (warpMarkers.length > 0 || endSyncTime !== undefined)) {
    return ["is a MIDI song with warp markers"];
  }

  const violations: string[] = [];
  const positioned: { position: number; time: number }[] = [];

  for (const marker of warpMarkers) {
    const position = findPosition(timeline, marker.measure, marker.occurrence);
    if (!hasKeys(marker, ["measure", "occurrence", "time"]) || typeof marker.time !== "number" || !Number.isFinite(marker.time)) {
      violations.push(`warp marker ${JSON.stringify(marker)} is malformed`);
    } else if (position === undefined) {
      violations.push(`warp marker ${JSON.stringify(marker)} is not in the recording`);
    } else {
      positioned.push({ position, time: marker.time });
    }
  }

  // The end sync point anchors where the last measure ends, one position after its start.
  if (endSyncTime !== undefined) {
    if (typeof endSyncTime !== "number" || !Number.isFinite(endSyncTime) || endSyncTime <= 0) {
      violations.push(`end sync time ${JSON.stringify(endSyncTime)} is malformed`);
    } else if (timeline.length === 0) {
      violations.push("end sync time is set for a recording without measures");
    } else {
      positioned.push({ position: timeline.length, time: endSyncTime });
    }
  }

  positioned.sort((a, b) => a.position - b.position);
  const increasing = positioned.every((marker, i) => i === 0 || (marker.position > positioned[i - 1]!.position && marker.time > positioned[i - 1]!.time));
  return increasing ? violations : [...violations, "warp marker times do not strictly increase in timeline order"];
}

type Point = { position: number; beat: number };

function isBefore(a: Point, b: Point): boolean {
  return a.position < b.position || (a.position === b.position && a.beat < b.beat);
}

/** The timeline point of a stored location, or a violation when it does not resolve. */
function resolveLocation({ measures }: Layers, timeline: TimelineEntry[], location: unknown, name: string, violations: string[]): Point | undefined {
  if (!isObject(location) || !hasKeys(location, ["measure", "beat"], ["occurrence"])) {
    violations.push(`${name} ${JSON.stringify(location)} is malformed`);
    return undefined;
  }

  const measure = measures.find(m => m.id === location.measure);
  const occurrence = location.occurrence ?? 1;
  const position = findPosition(timeline, location.measure, occurrence);
  const beat = location.beat as number;
  const beatInRange = Number.isInteger(beat) && beat >= 0 && beat < (measure?.beats ?? 0);

  if (!measure || !beatInRange || !isPositiveInteger(occurrence) || position === undefined) {
    violations.push(`${name} ${JSON.stringify(location)} does not reference an existing measure, beat and occurrence`);
    return undefined;
  }

  return { position, beat };
}

function sectionFieldViolation(section: Json): string | undefined {
  const keys = SECTION_KEYS[section.kind as string];
  if (!keys || !hasKeys(section, keys)) {
    return "is malformed";
  }

  if (section.kind === "repeat" && !isPositiveInteger(section.passes)) {
    return "needs at least one pass";
  }

  const vampFieldsValid = VAMP_OUTS.includes(section.out as string) && VAMP_VOCALS.includes(section.vocals as string);
  return section.kind === "vamp" && !vampFieldsValid ? "has invalid vamp fields" : undefined;
}

/** The last position of a section, counting the back-to-back repetitions of its first pass. */
function lastRecordedPosition(timeline: TimelineEntry[], from: Point, to: Point): number {
  const pass = timeline.slice(from.position, to.position + 1).map(entry => entry.measure);
  let last = to.position;

  while (pass.every((measure, offset) => timeline[last + 1 + offset]?.measure === measure)) {
    last += pass.length;
  }

  return last;
}

function arrangementViolations(layers: Layers, timeline: TimelineEntry[]): string[] {
  const violations: string[] = [];
  const extents: { from: Point; to: Point }[] = [];

  for (const marker of layers.markers) {
    if (!hasKeys(marker, ["at", "text"]) || typeof marker.text !== "string") {
      violations.push(`marker ${JSON.stringify(marker)} is malformed`);
      continue;
    }

    resolveLocation(layers, timeline, marker.at, `marker '${marker.text}' at`, violations);
  }

  for (const section of layers.sections) {
    const name = `section ${JSON.stringify(section)}`;
    const fieldViolation = sectionFieldViolation(section);
    if (fieldViolation) {
      violations.push(`${name} ${fieldViolation}`);
      continue;
    }

    const from = resolveLocation(layers, timeline, section.from, `${name} from`, violations);
    const to = resolveLocation(layers, timeline, section.to, `${name} to`, violations);
    if (!from || !to) {
      continue;
    }

    if (!isBefore(from, to)) {
      violations.push(`${name} does not start before it ends`);
      continue;
    }

    const extent = { from, to: { position: lastRecordedPosition(timeline, from, to), beat: to.beat } };
    if (extents.some(other => !isBefore(extent.to, other.from) && !isBefore(other.to, extent.from))) {
      violations.push(`${name} overlaps another section, counting its recorded passes`);
    }

    extents.push(extent);
  }

  return violations;
}

type BeatMapJson = { score?: { events?: { type: string; tickcount: number; value: { meas?: string } }[] } };

/** The number of bars a beat map plays, without the terminal bar that only ends the last one. */
function countBeatMapBars(beatMap: BeatMapJson): number {
  const beats = (beatMap.score?.events ?? []).filter(event => event.type === "BEAT").sort((a, b) => a.tickcount - b.tickcount);
  const groups = beats.filter((event, i) => i === 0 || event.value.meas !== beats[i - 1]!.value.meas);
  return Math.max(0, groups.length - 1);
}

/** The MIDI player refuses to load a beat map whose bar count differs from the recording. */
async function beatMapViolations(admin: PocketBase, song: RecordModel, timeline: TimelineEntry[]): Promise<string[]> {
  if (!song.midiFile) {
    return [];
  }

  if (!song.jsonFile) {
    return ["has a MIDI file but no beat map JSON, so MIDI playback cannot load"];
  }

  const response = await fetch(admin.files.getURL(song, song.jsonFile));
  const bars = countBeatMapBars(await response.json() as BeatMapJson);
  return bars === timeline.length ? [] : [`plays ${timeline.length} measures, but its beat map has ${bars} bars`];
}

function trackViolations(song: RecordModel): string[] {
  const audioFiles = new Set(asArray(song.audioFiles));
  return (song.tracks as { title: string; audioFile?: string }[])
    .filter(track => track.audioFile && !audioFiles.has(track.audioFile))
    .map(track => `track '${track.title}' uses audio file '${track.audioFile}', which is not in audioFiles`);
}

async function songViolations(admin: PocketBase, song: RecordModel): Promise<string[]> {
  const shape = layerShapeViolations(song);
  if (shape.length > 0) {
    return shape;
  }

  const layers: Layers = { ...song.score, ...song.recording, markers: song.arrangement.markers, sections: song.arrangement.sections };
  const violations = [...measureViolations(layers), ...trackViolations(song)];
  const timeline = expandSpans(layers, violations);

  return [
    ...violations,
    ...warpMarkerViolations(song, layers, timeline),
    ...arrangementViolations(layers, timeline),
    ...await beatMapViolations(admin, song, timeline),
  ];
}

/** The data invariants of the song layers, which `Song.deserialize()` and the player rely on. */
const songsLoadable: Invariant = {
  name: "songs are loadable by the frontend",
  check: async ({ admin, snapshot }) => {
    const violations: string[] = [];

    for (const song of snapshot.records.songs ?? []) {
      const messages = await songViolations(admin, song);
      violations.push(...messages.map(message => `songs/${song.id}: ${message}`));
    }

    return violations;
  },
};

/**
 * Rules every backend state must satisfy after any test, derived from what the frontend relies on.
 * Add a rule here whenever a feature introduces a new cross-record or cross-field constraint.
 */
export const DEFAULT_INVARIANTS: readonly Invariant[] = [relationsResolve, filesDownloadable, songsLoadable];

export async function findInvariantViolations(admin: PocketBase, invariants: readonly Invariant[] = DEFAULT_INVARIANTS): Promise<string[]> {
  const snapshot = await snapshotBackend(admin);
  const violations: string[] = [];

  for (const invariant of invariants) {
    const messages = await invariant.check({ admin, snapshot });
    violations.push(...messages.map(message => `[${invariant.name}] ${message}`));
  }

  return violations;
}
