import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type Permissions } from "@/pocketbase/auth";
import { dbCreate, dbCreateWithFiles, dbDelete, dbGetOne, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";

import { scoreFromBeatMap, tracksFromBeatMap } from "../midi/beatMap";
import type { MTIMidiJson } from "../midi/mtiJson";
import type { PlayerMode, SystemEvents } from "../player/types";
import { Emitter } from "../utils/events";
import type { UrlOrFile } from "../utils/file";
import type { Numbering } from "../utils/numbering";
import { inferTrackClassification } from "../utils/trackInference";
import {
  changesTiming,
  deserializeLayers,
  dropUnresolvedReferences,
  EMPTY_LAYERS,
  getChangedFields,
  type LayerField,
  type LayerSnapshot,
  planMeasureEdit,
  planRecordingChange,
  type RecordingPreview,
  serializeLayers,
  type SongLayers,
  sortReferences,
  toRecordingPreview,
  validateLayers,
} from "./layers";
import type { Marker } from "./markers";
import Measure, { isEmptyMeasureEdit, type MeasureEdit, type MeasureId, type MeasureLayout, nextMeasureIds } from "./measure";
import { expandRecording, type RecordingSpan, type StoredWarpMarker, type Timeline } from "./recording";
import type { Section } from "./sections";
import Track from "./track";

export type SongNumber = Numbering;

export type SongDetails = {
  number: SongNumber;
  title: string;
};

export type SongRecording = {
  file: File;
  title: string;
};

export type SongFiles = {
  score?: File;
  midi?: File;
  beatMap?: File;
  recordings?: SongRecording[];
};

/** Who changed the layers: an editing action, or the undo history restoring a snapshot. */
export type LayersOrigin = "edit" | "history";

/** One saved change of the layers. */
export type LayersChange = {
  before: LayerSnapshot;
  after: LayerSnapshot;
  /** The measure order, beats or recording changed, so the player has to load the song again. */
  timingChanged: boolean;
  origin: LayersOrigin;
};

const LAYER_FIELDS: Record<keyof LayerSnapshot, readonly LayerField[]> = {
  score: ["measures", "unnumberedBoxes"],
  recording: ["spans", "warpMarkers"],
  arrangement: ["markers", "sections", "segue"],
};

function replaceAll<T>(items: T[], replacement: readonly T[]): void {
  items.splice(0, items.length, ...replacement);
}

function getMeasureKey(measures: readonly Measure[]): string {
  return JSON.stringify(measures.map(measure => [measure.id, measure.beats]));
}

export default class Song {
  public playerMode: PlayerMode = "none";

  private readonly trackList: Track[];
  private readonly audioFileList: UrlOrFile[];
  private readonly measures: Measure[];
  private readonly unnumberedBoxes: MeasureLayout[];
  private readonly spans: RecordingSpan[];
  private readonly warpMarkers: StoredWarpMarker[];
  private readonly markers: Marker[];
  private readonly sections: Section[];
  private segue: boolean;
  /** The record's `updated` timestamp as of our last save, to notice changes made elsewhere. */
  private updated?: string;
  private timelineRevision = 0;
  // Vue does not proxy non-extensible objects, so filling the cache inside a computed triggers nothing.
  private readonly timelineCache: { revision: number; timeline?: Timeline } = Object.preventExtensions({ revision: -1, timeline: undefined });
  private readonly layersChange = new Emitter<LayersChange>();

  /** Fires after every saved change of the layers. */
  public readonly onLayersChange = this.layersChange.event;

  get tracks(): readonly Track[] {
    return this.trackList;
  }

  get audioFiles(): readonly UrlOrFile[] {
    return this.audioFileList;
  }

  constructor(
    public readonly id: string,
    public number: Numbering,
    public title: string,
    public midiFile: UrlOrFile | undefined,
    public jsonFile: UrlOrFile | undefined,
    public pdfFile: UrlOrFile | undefined,
    audioFiles: UrlOrFile[] = [],
    tracks: Track[] = [],
    layers: Partial<SongLayers> = {},
    public readonly permissions: Permissions = NoPermissions,
    public $midiSystemEvents: SystemEvents | object = {},
  ) {
    this.trackList = tracks;
    this.audioFileList = audioFiles;
    this.measures = [...layers.measures ?? []];
    this.unnumberedBoxes = [...layers.unnumberedBoxes ?? []];
    this.spans = [...layers.spans ?? []];
    this.warpMarkers = [...layers.warpMarkers ?? []];
    this.markers = [...layers.markers ?? []];
    this.sections = [...layers.sections ?? []];
    this.segue = layers.segue ?? false;
    // Stored data may come in any order (the backend migration writes sections in old event order), while the panels list it in timeline order.
    this.replaceLayers(sortReferences(this.getLayers()));

    this.trackList.forEach((track, i) => track.mixer.index = i);
    this.syncPlayerMode();
  }

  // Score

  /** Measures in score order. */
  public getMeasures(): readonly Measure[] {
    return this.measures;
  }

  public findMeasure(id: MeasureId): Measure | undefined {
    return this.measures.find(measure => measure.id === id);
  }

  public findMeasureByLabel(label: string): Measure | undefined {
    return this.measures.find(measure => measure.label === label);
  }

  /** The measure's index in score order, or -1 if the song has no such measure. */
  public getScoreIndex(id: MeasureId): number {
    return this.measures.findIndex(measure => measure.id === id);
  }

  /** Boxes on the score that belong to no measure yet. They wait for the user to number or remove them. */
  public getUnnumberedBoxes(): readonly MeasureLayout[] {
    return this.unnumberedBoxes;
  }

  // Recording

  /** The recording's measure order. */
  public getRecording(): readonly RecordingSpan[] {
    return this.spans;
  }

  /** The recording expanded into one entry per measure played. */
  public getTimeline(): Timeline {
    if (this.timelineCache.revision !== this.timelineRevision || !this.timelineCache.timeline) {
      this.timelineCache.timeline = expandRecording(this.measures, this.spans);
      this.timelineCache.revision = this.timelineRevision;
    }

    return this.timelineCache.timeline;
  }

  /** Audio sync anchors in timeline order. MIDI songs have none. */
  public getWarpMarkers(): readonly StoredWarpMarker[] {
    return this.warpMarkers;
  }

  /** MIDI songs take their recording from the beat map. */
  public isRecordingEditable(): boolean {
    return this.playerMode !== "midi";
  }

  // Arrangement

  /** Markers in timeline order. */
  public getMarkers(): readonly Marker[] {
    return this.markers;
  }

  /** Sections in timeline order. */
  public getSections(): readonly Section[] {
    return this.sections;
  }

  public hasSegue(): boolean {
    return this.segue;
  }

  // Internal helpers

  private async save(fields: PbRecord): Promise<PbRecord> {
    return this.rememberUpdated(await dbUpdate("songs", this.id, fields));
  }

  private async saveWithFiles(formData: FormData): Promise<PbRecord> {
    return this.rememberUpdated(await dbUpdateWithFiles("songs", this.id, formData));
  }

  private rememberUpdated(record: PbRecord): PbRecord {
    this.updated = record.updated ?? this.updated;
    return record;
  }

  private serializeTracks(): any[] {
    return this.trackList.map(t => t.serialize());
  }

  private syncPlayerMode(): void {
    if (this.midiFile) {
      this.playerMode = "midi";
    } else if (this.audioFileList.length > 0) {
      this.playerMode = "audio";
    } else {
      this.playerMode = "none";
    }
  }

  private updateEffectiveParameters(): void {
    const soloing = this.trackList.some(track => track.mixer.solo);
    this.trackList.forEach(track => track.mixer.effectiveMute = soloing ? !track.mixer.solo : track.mixer.mute);
    this.trackList.forEach(track => track.mixer.effectiveGain = track.mixer.effectiveMute ? 0.0 : track.mixer.gain);
  }

  private replaceLayers(layers: SongLayers): void {
    replaceAll(this.measures, layers.measures);
    replaceAll(this.unnumberedBoxes, layers.unnumberedBoxes);
    replaceAll(this.spans, layers.spans);
    replaceAll(this.warpMarkers, layers.warpMarkers);
    replaceAll(this.markers, layers.markers);
    replaceAll(this.sections, layers.sections);
    this.segue = layers.segue;
    this.timelineRevision++;
  }

  // Mixer (in-memory only, not persisted)

  public setTrackMute(trackIndex: number, value: boolean): void {
    if (!this.trackList[trackIndex]) {
      console.warn(`setTrackMute: track index ${trackIndex} out of range.`);
      return;
    }

    this.trackList[trackIndex]!.mixer.mute = value;
    this.updateEffectiveParameters();
  }

  public setTrackSolo(trackIndex: number, value: boolean): void {
    if (!this.trackList[trackIndex]) {
      console.warn(`setTrackSolo: track index ${trackIndex} out of range.`);
      return;
    }

    this.trackList[trackIndex]!.mixer.solo = value;
    this.updateEffectiveParameters();
  }

  public setTrackHighlight(trackIndex: number, value: boolean): void {
    if (!this.trackList[trackIndex]) {
      console.warn(`setTrackHighlight: track index ${trackIndex} out of range.`);
      return;
    }

    this.trackList[trackIndex]!.mixer.highlight = value;
  }

  public setTrackGain(trackIndex: number, value: number): void {
    if (!this.trackList[trackIndex]) {
      console.warn(`setTrackGain: track index ${trackIndex} out of range.`);
      return;
    }

    this.trackList[trackIndex]!.mixer.gain = Math.max(0, Math.min(1, value));
    this.updateEffectiveParameters();
  }

  // Track mutations

  public async addTracks(tracks: Track[]): Promise<void> {
    for (const track of tracks) {
      track.mixer.index = this.trackList.length;
      this.trackList.push(track);
    }

    await this.save({ tracks: this.serializeTracks() });
  }

  public async setTracks(tracks: Track[]): Promise<void> {
    replaceAll(this.trackList, tracks);
    this.trackList.forEach((t, i) => (t.mixer.index = i));
    await this.save({ tracks: this.serializeTracks() });
  }

  // File mutations

  public async updateDetails({ number, title }: SongDetails): Promise<void> {
    await this.save({ number, title });
    this.number = number;
    this.title = title;
  }

  /**
   * Uploads score, MIDI and recordings in one request. A beat map rebuilds the score and the
   * recording, and fills in the MIDI tracks while the song has none, so a freshly imported MIDI song
   * is playable at once.
   */
  public async addFiles({ score, midi, beatMap, recordings = [] }: SongFiles): Promise<void> {
    const formData = new FormData();
    const beatMapJson = beatMap ? JSON.parse(await beatMap.text()) as MTIMidiJson : undefined;
    const layers = beatMapJson && this.planBeatMap(beatMapJson);

    if (score) {
      formData.append("pdfFile", score);
    }

    if (midi) {
      formData.append("midiFile", midi);
    }

    if (beatMap) {
      formData.append("jsonFile", beatMap);
    }

    if (layers) {
      const { score: storedScore, recording, arrangement } = serializeLayers(layers);
      formData.append("score", JSON.stringify(storedScore));
      formData.append("recording", JSON.stringify(recording));
      const fields = getChangedFields(this.getLayers(), layers);
      if (fields.has("markers") || fields.has("sections")) {
        formData.append("arrangement", JSON.stringify(arrangement));
      }
    }

    const tracks = beatMapJson && this.trackList.length === 0 ? tracksFromBeatMap(beatMapJson) : [];
    if (tracks.length > 0) {
      formData.append("tracks", JSON.stringify(tracks.map(track => track.serialize())));
    }

    if ([...formData.keys()].length === 0) {
      await this.addRecordings(recordings);
      return;
    }

    const record = await this.saveWithFiles(formData);
    this.pdfFile = record.pdfFile || this.pdfFile;
    this.midiFile = record.midiFile || this.midiFile;
    this.jsonFile = record.jsonFile || this.jsonFile;
    if (layers) {
      this.replaceLayers(layers);
    }

    this.trackList.push(...tracks);
    this.trackList.forEach((track, i) => track.mixer.index = i);
    this.syncPlayerMode();

    await this.addRecordings(recordings);
  }

  /**
   * Score and recording of the beat map. Measures whose label stays keep their ID and box, so
   * references to them survive. Boxes of measures that are gone wait as unnumbered boxes.
   */
  private planBeatMap(beatMap: MTIMidiJson): SongLayers {
    const built = scoreFromBeatMap(beatMap);
    const previous = new Map(this.measures.map(measure => [measure.label, measure]));
    const freshIds = nextMeasureIds(this.measures, built.measures.length);
    const ids = new Map<MeasureId, MeasureId>();

    const measures = built.measures.map((measure, i) => {
      const kept = previous.get(measure.label);
      previous.delete(measure.label);
      const id = kept?.id ?? freshIds[i]!;
      ids.set(measure.id, id);
      return new Measure(id, measure.label, measure.beats, kept?.layout);
    });

    const orphanedBoxes = [...previous.values()].flatMap(measure => measure.layout ? [measure.layout] : []);
    return dropUnresolvedReferences({
      ...this.getLayers(),
      measures,
      unnumberedBoxes: [...this.unnumberedBoxes, ...orphanedBoxes],
      spans: built.recording.map(({ from, to }) => ({ from: ids.get(from)!, to: ids.get(to)! })),
      warpMarkers: [],
    });
  }

  public async addRecordings(recordings: SongRecording[]): Promise<void> {
    if (recordings.length === 0) {
      return;
    }

    const filenames = await this.uploadAudioFiles(recordings.map(recording => recording.file));
    await this.addTracks(recordings.map((recording, i) => new Track(
      recording.title,
      inferTrackClassification(recording.title),
      0,
      filenames[i] ?? "",
    )));
  }

  public async removeScore(): Promise<void> {
    await this.save({ pdfFile: null });
    this.pdfFile = undefined;
  }

  // Without its beat map a MIDI file cannot play, so both are always removed together.
  public async removeMidiFile(): Promise<void> {
    this.midiFile = undefined;
    this.jsonFile = undefined;
    this.trackList.splice(0, this.trackList.length);
    this.syncPlayerMode();
    await this.save({ midiFile: null, jsonFile: null, tracks: [] });
  }

  public async uploadAudioFiles(files: File[]): Promise<string[]> {
    if (files.length === 0) {
      return [];
    }

    const prevFilenames = new Set(
      this.audioFileList.map(f => (typeof f === "string" ? f : f.name)),
    );

    const formData = new FormData();

    // Without the "+" modifier PocketBase replaces all existing audio files, orphaning their tracks.
    for (const file of files) {
      formData.append("audioFiles+", file);
    }

    const record = await this.saveWithFiles(formData);
    const newFilenames = (record.audioFiles as string[]).filter(f => !prevFilenames.has(f));

    for (const filename of newFilenames) {
      this.audioFileList.push(filename);
    }

    this.syncPlayerMode();

    return newFilenames;
  }

  public async uploadAudioFile(file: File): Promise<string> {
    const [filename] = await this.uploadAudioFiles([file]);

    if (!filename) {
      throw new Error("File upload failed: could not determine uploaded filename");
    }

    return filename;
  }

  public async removeAudioFile(filename: string): Promise<void> {
    await this.save({ "audioFiles-": filename });
    const idx = this.audioFileList.findIndex(
      f => (typeof f === "string" ? f : f.name) === filename,
    );
    if (idx !== -1) {
      this.audioFileList.splice(idx, 1);
    }

    for (let i = this.trackList.length - 1; i >= 0; i--) {
      if (this.trackList[i]!.audioFile === filename) {
        this.trackList.splice(i, 1);
      }
    }

    this.trackList.forEach((t, i) => (t.mixer.index = i));
    this.syncPlayerMode();
    await this.save({ tracks: this.serializeTracks() });
  }

  // Layer mutations

  /** The current score, recording and arrangement, to compute the next ones from. */
  public getLayers(): SongLayers {
    return {
      measures: this.measures,
      unnumberedBoxes: this.unnumberedBoxes,
      spans: this.spans,
      warpMarkers: this.warpMarkers,
      markers: this.markers,
      sections: this.sections,
      segue: this.segue,
    };
  }

  /** A MIDI song plays its beat map, so only labels, boxes and the arrangement may change. */
  private validateMidiLayers(current: SongLayers, next: SongLayers, fields: ReadonlySet<LayerField>): string | undefined {
    if (fields.has("measures") && getMeasureKey(current.measures) !== getMeasureKey(next.measures)) {
      return "A MIDI song only has the measures of its beat map.";
    }

    if (fields.has("spans")) {
      return "A MIDI song takes its recording from the beat map.";
    }

    return fields.has("warpMarkers") && next.warpMarkers.length > 0 ? "A MIDI song takes its timing from the beat map." : undefined;
  }

  /**
   * The one way to change the score, recording and arrangement. Merges `change` into the current layers,
   * puts references in timeline order, validates the result and saves every changed layer in one request.
   * Nothing changes when validation or the save fails. Returns undefined when nothing would change.
   */
  public async editLayers(change: Partial<SongLayers>, origin: LayersOrigin = "edit"): Promise<LayersChange | undefined> {
    const current = this.getLayers();
    const next = sortReferences({ ...current, ...change });
    const fields = getChangedFields(current, next);
    if (fields.size === 0) {
      return undefined;
    }

    const reason = (this.playerMode === "midi" ? this.validateMidiLayers(current, next, fields) : undefined) ?? validateLayers(next, fields);
    if (reason) {
      throw new Error(reason);
    }

    const before = serializeLayers(current);
    const after = serializeLayers(next);
    const layers = Object.keys(LAYER_FIELDS) as (keyof LayerSnapshot)[];
    const changed = layers.filter(layer => LAYER_FIELDS[layer].some(field => fields.has(field)));
    await this.save(Object.fromEntries(changed.map(layer => [layer, after[layer]])));

    const result: LayersChange = { before, after, timingChanged: changesTiming(current, next), origin };
    this.replaceLayers(next);
    this.layersChange.fire(result);
    return result;
  }

  /** Writes a snapshot back, for undo and redo. */
  public async restoreLayers(snapshot: LayerSnapshot): Promise<LayersChange | undefined> {
    return this.editLayers(deserializeLayers(snapshot), "history");
  }

  /** The stored form of the current layers. */
  public getLayerSnapshot(): LayerSnapshot {
    return serializeLayers(this.getLayers());
  }

  /** Whether someone else saved the record since our last save, which an undo would overwrite. */
  public async isChangedElsewhere(): Promise<boolean> {
    const { updated } = await dbGetOne("songs", this.id, "updated");
    return updated !== this.updated;
  }

  /** Applies a whole measure edit in one save. Returns the added measures in the order of `edit.additions`. */
  public async applyMeasureEdit(edit: MeasureEdit): Promise<Measure[]> {
    if (isEmptyMeasureEdit(edit)) {
      return [];
    }

    const { layers, added } = planMeasureEdit(this.getLayers(), edit);
    await this.editLayers(layers);
    return added;
  }

  /** What `setRecordingSpans(spans)` would do, for showing before saving. Throws like it on invalid spans. */
  public previewRecordingSpans(spans: readonly RecordingSpan[]): RecordingPreview {
    return toRecordingPreview(planRecordingChange(this.getLayers(), this.measures, spans));
  }

  /**
   * Replaces the recording. Warp markers keep their times, and they, markers and sections move with
   * their timeline position wherever it survives the change. Only the rest are dropped.
   */
  public async setRecordingSpans(spans: readonly RecordingSpan[]): Promise<void> {
    await this.editLayers(planRecordingChange(this.getLayers(), this.measures, spans).layers);
  }

  // Serialization and persistence

  public serialize(): PbRecord {
    return {
      number: this.number,
      title: this.title,
      midiFile: this.midiFile,
      jsonFile: this.jsonFile,
      pdfFile: this.pdfFile,
      audioFiles: this.audioFileList,
      tracks: this.serializeTracks(),
      ...this.getLayerSnapshot(),
    };
  }

  public static deserialize({ id, number, title, midiFile, jsonFile, pdfFile, audioFiles, tracks, score, recording, arrangement, updated }: PbRecord, showPermissions?: Permissions): Song {
    const song = new Song(
      id,
      number,
      title,
      midiFile,
      jsonFile,
      pdfFile,
      audioFiles,
      tracks.map((t: PbRecord) => Track.deserialize(t)),
      deserializeLayers({ score, recording, arrangement }),
      showPermissions ?? NoPermissions,
    );
    song.updated = updated;
    return song;
  }

  public async create(): Promise<PbRecord> {
    return await dbCreate("songs", this.serialize());
  }

  public static async create(showId: string, { number, title }: SongDetails, files: SongFiles = {}, permissions?: Permissions): Promise<Song> {
    const formData = new FormData();
    formData.append("show", showId);
    formData.append("number", number);
    formData.append("title", title);
    formData.append("tracks", "[]");
    formData.append("score", JSON.stringify(EMPTY_LAYERS.score));
    formData.append("recording", JSON.stringify(EMPTY_LAYERS.recording));
    formData.append("arrangement", JSON.stringify(EMPTY_LAYERS.arrangement));

    const record = await dbCreateWithFiles("songs", formData);
    const song = Song.deserialize({ ...record, tracks: [], ...EMPTY_LAYERS }, permissions);
    await song.addFiles(files);
    return song;
  }

  public async delete(): Promise<void> {
    await dbDelete("songs", this.id);
  }

  public static async list(): Promise<Song[]> {
    const records = await pb.collection("songs").getFullList();
    return records.map(record => Song.deserialize(record));
  }

  public static async get(id: string): Promise<Song> {
    const record = await pb.collection("songs").getOne(id);
    return Song.deserialize(record);
  }
}
