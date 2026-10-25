import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type Permissions } from "@/pocketbase/auth";
import { dbCreate, dbCreateWithFiles, dbDelete, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";

import { scoreFromBeatMap, tracksFromBeatMap } from "../midi/beatMap";
import type { PlayerMode, SystemEvents } from "../player/types";
import type { MTIMidiJson } from "../scripts/jsonTypes/mti";
import type { UrlOrFile } from "../utils/file";
import type { Numbering } from "../utils/numbering";
import { inferTrackClassification } from "../utils/trackInference";
import { deserializeMarker, type Marker, serializeMarker, type StoredMarker } from "./markers";
import Measure, {
  changesPlayback,
  isEmptyMeasureEdit,
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
  type Location,
  type Occurrence,
  type RecordingSpan,
  removeMeasureFromSpans,
  type StoredRecording,
  type StoredWarpMarker,
  type Timeline,
  validateLocation,
} from "./recording";
import { compareSections, deserializeSection, type Section, serializeSection, type StoredSection, validateSections } from "./sections";
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
  measures?: Measure[];
  unnumberedBoxes?: MeasureLayout[];
  spans?: RecordingSpan[];
  warpMarkers?: StoredWarpMarker[];
  markers?: Marker[];
  sections?: Section[];
  segue?: boolean;
};

const EMPTY_SCORE: StoredScore = Object.freeze({ measures: [], unnumberedBoxes: [] }) as StoredScore;
const EMPTY_RECORDING: StoredRecording = Object.freeze({ spans: [], warpMarkers: [] }) as StoredRecording;
const EMPTY_ARRANGEMENT: StoredArrangement = Object.freeze({ markers: [], sections: [], segue: false }) as StoredArrangement;

function insertSorted<T>(items: T[], item: T, compare: (a: T, b: T) => number): void {
  const index = items.findIndex(existing => compare(existing, item) > 0);
  items.splice(index === -1 ? items.length : index, 0, item);
}

function replaceAll<T>(items: T[], replacement: readonly T[]): void {
  items.splice(0, items.length, ...replacement);
}

function isSameOccurrence(a: Occurrence, b: Occurrence): boolean {
  return a.measure === b.measure && a.occurrence === b.occurrence;
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
  private timelineRevision = 0;
  // Vue does not proxy non-extensible objects, so filling the cache inside a computed triggers nothing.
  private readonly timelineCache: { revision: number; timeline?: Timeline } = Object.preventExtensions({ revision: -1, timeline: undefined });

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
    layers: SongLayers = {},
    public readonly permissions: Permissions = NoPermissions,
    public $midiSystemEvents: SystemEvents | object = {},
  ) {
    this.trackList = tracks;
    this.audioFileList = audioFiles;
    this.measures = layers.measures ?? [];
    this.unnumberedBoxes = layers.unnumberedBoxes ?? [];
    this.spans = layers.spans ?? [];
    this.warpMarkers = layers.warpMarkers ?? [];
    this.markers = layers.markers ?? [];
    this.sections = layers.sections ?? [];
    this.segue = layers.segue ?? false;

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
    return dbUpdate("songs", this.id, fields);
  }

  private serializeTracks(): any[] {
    return this.trackList.map(t => t.serialize());
  }

  private serializeScore(): StoredScore {
    return { measures: this.measures.map(measure => measure.serialize()), unnumberedBoxes: [...this.unnumberedBoxes] };
  }

  private serializeRecording(): StoredRecording {
    return { spans: this.spans.map(span => ({ ...span })), warpMarkers: this.warpMarkers.map(marker => ({ ...marker })) };
  }

  private serializeArrangement(): StoredArrangement {
    return { markers: this.markers.map(serializeMarker), sections: this.sections.map(serializeSection), segue: this.segue };
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

  private invalidateTimeline(): void {
    this.timelineRevision++;
  }

  private compareWarpMarkers(a: StoredWarpMarker, b: StoredWarpMarker): number {
    return (findPosition(this.getTimeline(), a) ?? Infinity) - (findPosition(this.getTimeline(), b) ?? Infinity);
  }

  /**
   * Drops every warp marker, marker and section that no longer resolves after the measures or the
   * recording changed. Returns which layers changed.
   */
  private dropUnresolvedReferences(): { recording: boolean; arrangement: boolean } {
    const timeline = this.getTimeline();
    const warpMarkers = this.warpMarkers.filter(marker => findPosition(timeline, marker) !== undefined);
    const markers = this.markers.filter(marker => !validateLocation(this.measures, timeline, marker.at));
    const invalid = new Set(validateSections(this.measures, timeline, this.sections).map(issue => issue.index));
    const sections = this.sections.filter((_, index) => !invalid.has(index));

    const changes = {
      recording: warpMarkers.length !== this.warpMarkers.length,
      arrangement: markers.length !== this.markers.length || sections.length !== this.sections.length,
    };

    replaceAll(this.warpMarkers, warpMarkers);
    replaceAll(this.markers, markers);
    replaceAll(this.sections, sections);
    return changes;
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

    if (score) {
      formData.append("pdfFile", score);
    }

    if (midi) {
      formData.append("midiFile", midi);
    }

    if (beatMap) {
      formData.append("jsonFile", beatMap);
    }

    if (beatMapJson) {
      const { arrangement } = this.applyBeatMap(beatMapJson);
      formData.append("score", JSON.stringify(this.serializeScore()));
      formData.append("recording", JSON.stringify(this.serializeRecording()));
      if (arrangement) {
        formData.append("arrangement", JSON.stringify(this.serializeArrangement()));
      }
    }

    if (beatMapJson && this.trackList.length === 0) {
      this.trackList.push(...tracksFromBeatMap(beatMapJson));
      this.trackList.forEach((track, i) => track.mixer.index = i);
      formData.append("tracks", JSON.stringify(this.serializeTracks()));
    }

    if ([...formData.keys()].length === 0) {
      await this.addRecordings(recordings);
      return;
    }

    const record = await dbUpdateWithFiles("songs", this.id, formData);
    this.pdfFile = record.pdfFile || this.pdfFile;
    this.midiFile = record.midiFile || this.midiFile;
    this.jsonFile = record.jsonFile || this.jsonFile;
    this.syncPlayerMode();

    await this.addRecordings(recordings);
  }

  /**
   * Replaces score and recording with those of the beat map. Measures whose label stays keep their ID
   * and box, so references to them survive. Boxes of measures that are gone wait as unnumbered boxes.
   */
  private applyBeatMap(beatMap: MTIMidiJson): { arrangement: boolean } {
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
    replaceAll(this.measures, measures);
    this.unnumberedBoxes.push(...orphanedBoxes);
    replaceAll(this.spans, built.recording.map(({ from, to }) => ({ from: ids.get(from)!, to: ids.get(to)! })));
    replaceAll(this.warpMarkers, []);
    this.invalidateTimeline();

    return { arrangement: this.dropUnresolvedReferences().arrangement };
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

    const record = await dbUpdateWithFiles("songs", this.id, formData);
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
    await dbUpdate("songs", this.id, { "audioFiles-": filename });
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

  // Measure mutations

  private validateMeasureEdit(edit: MeasureEdit): void {
    const changesMeasures = edit.additions.length > 0 || edit.removals.length > 0 || edit.beats.size > 0;
    if (this.playerMode === "midi" && changesMeasures) {
      throw new Error("A MIDI song only has the measures of its beat map.");
    }

    const referenced = [...edit.removals, ...edit.relabels.keys(), ...edit.layouts.keys(), ...edit.beats.keys()];
    const unknown = referenced.find(id => !this.findMeasure(id));
    if (unknown) {
      throw new Error(`Measure ${unknown} does not exist.`);
    }

    const beats = [...edit.beats.values(), ...edit.additions.map(addition => addition.beats)];
    if (beats.some(value => !Number.isInteger(value) || value < 1)) {
      throw new Error("Measures need a positive whole number of beats.");
    }

    const removed = new Set(edit.removals);
    const labels = [
      ...this.measures.filter(measure => !removed.has(measure.id)).map(measure => edit.relabels.get(measure.id) ?? measure.label),
      ...edit.additions.map(addition => addition.label),
    ];
    if (labels.some(label => label.trim() === "")) {
      throw new Error("Measure labels must not be empty.");
    }

    const duplicate = labels.find((label, i) => labels.indexOf(label) !== i);
    if (duplicate !== undefined) {
      throw new Error(`Measure ${duplicate} exists twice.`);
    }
  }

  private removeMeasures(ids: readonly MeasureId[]): void {
    for (const id of ids) {
      replaceAll(this.spans, removeMeasureFromSpans(this.spans, this.measures.map(measure => measure.id), id));
      this.measures.splice(this.getScoreIndex(id), 1);
    }
  }

  private updateMeasures<T>(changes: Map<MeasureId, T>, update: (measure: Measure, value: T) => void): void {
    changes.forEach((value, id) => {
      const measure = this.findMeasure(id);
      if (measure) {
        update(measure, value);
      }
    });
  }

  private addMeasures(additions: readonly MeasureAddition[], ids: readonly MeasureId[]): Measure[] {
    const ordered = additions.map((addition, i) => ({ addition, id: ids[i]! })).sort((a, b) => a.addition.index - b.addition.index);

    for (const { addition, id } of ordered) {
      const index = Math.max(0, Math.min(addition.index, this.measures.length));
      this.measures.splice(index, 0, new Measure(id, addition.label, addition.beats, addition.layout));
      replaceAll(this.spans, addMeasureToSpans(this.spans, this.measures.map(measure => measure.id), id));
    }

    return ids.map(id => this.findMeasure(id)!);
  }

  /**
   * Applies a whole measure edit in one save. Removed measures take their warp markers, markers and
   * sections along, and the recording follows added and removed measures. Returns the added measures
   * in the order of `edit.additions`.
   */
  public async applyMeasureEdit(edit: MeasureEdit): Promise<Measure[]> {
    if (isEmptyMeasureEdit(edit)) {
      return [];
    }

    this.validateMeasureEdit(edit);
    const recordingBefore = JSON.stringify(this.serializeRecording());
    const ids = nextMeasureIds(this.measures, edit.additions.length);

    this.removeMeasures(edit.removals);
    this.updateMeasures(edit.relabels, (measure, label) => measure.label = label);
    this.updateMeasures(edit.layouts, (measure, layout) => measure.layout = layout);
    this.updateMeasures(edit.beats, (measure, beats) => measure.beats = beats);
    const added = this.addMeasures(edit.additions, ids);

    if (edit.unnumberedBoxes) {
      replaceAll(this.unnumberedBoxes, edit.unnumberedBoxes);
    }

    const fields: PbRecord = { score: this.serializeScore() };
    if (changesPlayback(edit)) {
      this.invalidateTimeline();
      const changes = this.dropUnresolvedReferences();
      if (changes.recording || JSON.stringify(this.serializeRecording()) !== recordingBefore) {
        fields.recording = this.serializeRecording();
      }

      if (changes.arrangement) {
        fields.arrangement = this.serializeArrangement();
      }
    }

    await this.save(fields);
    return added;
  }

  // Recording mutations

  public async setRecordingSpans(spans: RecordingSpan[]): Promise<void> {
    expandRecording(this.measures, spans);
    replaceAll(this.spans, spans.map(span => ({ ...span })));
    this.invalidateTimeline();

    const fields: PbRecord = {};
    if (this.dropUnresolvedReferences().arrangement) {
      fields.arrangement = this.serializeArrangement();
    }

    await this.save({ recording: this.serializeRecording(), ...fields });
  }

  private findWarpMarkerIndex(occurrence: Occurrence): number {
    return this.warpMarkers.findIndex(marker => isSameOccurrence(marker, occurrence));
  }

  public async addWarpMarker(marker: StoredWarpMarker): Promise<void> {
    if (this.playerMode === "midi") {
      throw new Error("A MIDI song takes its timing from the beat map.");
    }

    if (findPosition(this.getTimeline(), marker) === undefined) {
      throw new Error(`Measure ${marker.measure} is not played ${marker.occurrence} times.`);
    }

    if (this.findWarpMarkerIndex(marker) !== -1) {
      throw new Error(`Measure ${marker.measure} already has a warp marker.`);
    }

    insertSorted(this.warpMarkers, { ...marker }, (a, b) => this.compareWarpMarkers(a, b));
    await this.save({ recording: this.serializeRecording() });
  }

  public async moveWarpMarker(occurrence: Occurrence, time: number): Promise<void> {
    const marker = this.warpMarkers[this.findWarpMarkerIndex(occurrence)];
    if (!marker) {
      return;
    }

    marker.time = time;
    await this.save({ recording: this.serializeRecording() });
  }

  public async removeWarpMarker(occurrence: Occurrence): Promise<void> {
    const index = this.findWarpMarkerIndex(occurrence);
    if (index === -1) {
      return;
    }

    this.warpMarkers.splice(index, 1);
    await this.save({ recording: this.serializeRecording() });
  }

  // Arrangement mutations

  private assertLocation(location: Location): void {
    const reason = validateLocation(this.measures, this.getTimeline(), location);
    if (reason) {
      throw new Error(reason);
    }
  }

  private compareMarkers(a: Marker, b: Marker): number {
    return compareLocations(this.getTimeline(), a.at, b.at);
  }

  public async addMarker(at: Location, text: string): Promise<Marker> {
    this.assertLocation(at);
    const marker = { at: { ...at }, text };
    insertSorted(this.markers, marker, (a, b) => this.compareMarkers(a, b));
    await this.save({ arrangement: this.serializeArrangement() });
    return this.markers[this.markers.indexOf(marker)]!;
  }

  // Markers can share a location, so they are found by identity instead of by position.
  public async updateMarker(marker: Marker, at: Location, text: string): Promise<void> {
    this.assertLocation(at);
    const index = this.markers.indexOf(marker);
    if (index === -1) {
      return;
    }

    const [moved] = this.markers.splice(index, 1);
    moved!.at = { ...at };
    moved!.text = text;
    insertSorted(this.markers, moved!, (a, b) => this.compareMarkers(a, b));
    await this.save({ arrangement: this.serializeArrangement() });
  }

  public async removeMarker(marker: Marker): Promise<void> {
    const index = this.markers.indexOf(marker);
    if (index === -1) {
      return;
    }

    this.markers.splice(index, 1);
    await this.save({ arrangement: this.serializeArrangement() });
  }

  private assertSections(sections: readonly Section[]): void {
    const [issue] = validateSections(this.measures, this.getTimeline(), sections);
    if (issue) {
      throw new Error(issue.reason);
    }
  }

  private async saveSections(sections: Section[]): Promise<void> {
    const timeline = this.getTimeline();
    this.assertSections(sections);
    replaceAll(this.sections, [...sections].sort((a, b) => compareSections(timeline, a, b)));
    await this.save({ arrangement: this.serializeArrangement() });
  }

  public async addSection(section: Section): Promise<void> {
    await this.saveSections([...this.sections, section]);
  }

  public async updateSection(index: number, section: Section): Promise<void> {
    if (!this.sections[index]) {
      return;
    }

    await this.saveSections(this.sections.map((existing, i) => i === index ? section : existing));
  }

  public async removeSection(index: number): Promise<void> {
    if (!this.sections[index]) {
      return;
    }

    await this.saveSections(this.sections.filter((_, i) => i !== index));
  }

  public async setSegue(segue: boolean): Promise<void> {
    this.segue = segue;
    await this.save({ arrangement: this.serializeArrangement() });
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
      score: this.serializeScore(),
      recording: this.serializeRecording(),
      arrangement: this.serializeArrangement(),
    };
  }

  public static deserialize({ id, number, title, midiFile, jsonFile, pdfFile, audioFiles, tracks, score, recording, arrangement }: PbRecord, showPermissions?: Permissions): Song {
    const { measures, unnumberedBoxes } = score as StoredScore;
    const { spans, warpMarkers } = recording as StoredRecording;
    const { markers, sections, segue } = arrangement as StoredArrangement;

    return new Song(
      id,
      number,
      title,
      midiFile,
      jsonFile,
      pdfFile,
      audioFiles,
      tracks.map((t: PbRecord) => Track.deserialize(t)),
      {
        measures: measures.map(Measure.deserialize),
        unnumberedBoxes: [...unnumberedBoxes],
        spans: spans.map(span => ({ ...span })),
        warpMarkers: warpMarkers.map(marker => ({ ...marker })),
        markers: markers.map(deserializeMarker),
        sections: sections.map(deserializeSection),
        segue,
      },
      showPermissions ?? NoPermissions,
    );
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
    formData.append("score", JSON.stringify(EMPTY_SCORE));
    formData.append("recording", JSON.stringify(EMPTY_RECORDING));
    formData.append("arrangement", JSON.stringify(EMPTY_ARRANGEMENT));

    const record = await dbCreateWithFiles("songs", formData);
    const song = Song.deserialize({ ...record, tracks: [], score: EMPTY_SCORE, recording: EMPTY_RECORDING, arrangement: EMPTY_ARRANGEMENT }, permissions);
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
