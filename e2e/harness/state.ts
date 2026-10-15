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

type MeasureReference = [string, number];

function isMeasureReference(value: unknown): value is MeasureReference {
  return Array.isArray(value) && typeof value[0] === "string" && typeof value[1] === "number";
}

/** The frontend's `Song.deserialize()` crashes on records that break these rules. */
function songShapeViolations(song: RecordModel): string[] {
  const violations: string[] = [];
  const { tracks, measures, events, warpMarkers } = song;

  if (!Array.isArray(tracks)) {
    violations.push("tracks is not an array");
  }

  if (!Array.isArray(measures)) {
    violations.push("measures is not an array");
  } else if (measures.some(m => typeof m?.value !== "string" || !Number.isInteger(m?.beats) || m.beats < 1)) {
    violations.push("measures contain an entry without a string value and positive integer beats");
  }

  if (!events || !Array.isArray(events.markers) || !Array.isArray(events.vamps) || typeof events.segue !== "boolean") {
    violations.push("events is not { markers: [], vamps: [], segue: boolean }");
  }

  if (warpMarkers !== null && warpMarkers !== undefined && warpMarkers !== "" && !Array.isArray(warpMarkers)) {
    violations.push("warpMarkers is neither empty nor an array");
  }

  return violations;
}

function songReferenceViolations(song: RecordModel): string[] {
  const violations: string[] = [];
  const measureValues: string[] = song.measures.map((m: { value: string }) => m.value);
  const knownMeasures = new Set(measureValues);
  const audioFiles = new Set(asArray(song.audioFiles));

  if (knownMeasures.size !== measureValues.length) {
    violations.push("measure numbers are not unique");
  }

  for (const track of song.tracks) {
    if (track.audioFile && !audioFiles.has(track.audioFile)) {
      violations.push(`track '${track.title}' uses audio file '${track.audioFile}', which is not in audioFiles`);
    }
  }

  if (song.midiFile && !song.jsonFile) {
    violations.push("has a MIDI file but no beat map JSON, so MIDI playback cannot load");
  }

  const references: [string, unknown][] = [
    ...song.events.markers.map((m: { start: unknown }) => ["marker", m.start] as [string, unknown]),
    ...song.events.vamps.flatMap((v: { start: unknown; end: unknown }) => [["vamp start", v.start], ["vamp end", v.end]] as [string, unknown][]),
  ];

  for (const [label, reference] of references) {
    if (!isMeasureReference(reference) || !knownMeasures.has(reference[0])) {
      violations.push(`${label} ${JSON.stringify(reference)} does not reference an existing measure`);
    }
  }

  const warpMarkers: { measure: unknown; time: number }[] = Array.isArray(song.warpMarkers) ? song.warpMarkers : [];
  for (const marker of warpMarkers) {
    if (typeof marker.measure === "string" && !knownMeasures.has(marker.measure)) {
      violations.push(`warp marker at measure '${marker.measure}' does not reference an existing measure`);
    }
  }

  const times = warpMarkers.map(marker => marker.time);
  if (times.some((time, i) => i > 0 && time <= times[i - 1]!)) {
    violations.push("warp marker times are not strictly increasing");
  }

  return violations;
}

const songsLoadable: Invariant = {
  name: "songs are loadable by the frontend",
  check: ({ snapshot }) => (snapshot.records.songs ?? []).flatMap((song) => {
    const shape = songShapeViolations(song);
    const violations = shape.length > 0 ? shape : songReferenceViolations(song);
    return violations.map(violation => `songs/${song.id}: ${violation}`);
  }),
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
