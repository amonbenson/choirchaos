import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type Permissions } from "@/pocketbase/auth";
import { dbCreate, dbCreateWithFiles, dbDelete, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";

import { measuresFromBeatMap, tracksFromBeatMap } from "../midi/beatMap";
import type { Tick } from "../midi/types";
import type { WarpMarker } from "../midi/warp";
import type { PlayerMode, SystemEvents } from "../player/types";
import { binarySearch } from "../utils/binarySearch";
import type { UrlOrFile } from "../utils/file";
import type { Numbering } from "../utils/numbering";
import { inferTrackClassification } from "../utils/trackInference";
import Measure, { type MeasureLayout, MeasureList } from "./measure";
import { MarkerEvent, MeasureEventList, VampEvent } from "./measureEvent";
import Track, { type TrackPatch } from "./track";

export type SongNumber = Numbering;

export type SongEvents = {
  markers: MeasureEventList<MarkerEvent>;
  vamps: MeasureEventList<VampEvent>;
  segue: boolean;
};

export type SongWarpMarker = {
  measure: Numbering; // measure number (e.g. "1", "2a")
  time: number;
};

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

const EMPTY_EVENTS = Object.freeze({ markers: [], vamps: [], segue: false });

export default class Song {
  public playerMode: PlayerMode = "none";

  private readonly _tracks: Track[];
  private readonly _audioFiles: UrlOrFile[];
  private readonly _warpMarkers: SongWarpMarker[];

  get tracks(): readonly Track[] {
    return this._tracks;
  }

  get audioFiles(): readonly UrlOrFile[] {
    return this._audioFiles;
  }

  get warpMarkers(): readonly SongWarpMarker[] {
    return this._warpMarkers;
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
    public readonly measures: MeasureList = new MeasureList(),
    public readonly events: SongEvents = {
      markers: new MeasureEventList<MarkerEvent>(),
      vamps: new MeasureEventList<VampEvent>(),
      segue: false,
    },
    warpMarkers: SongWarpMarker[] = [],
    public readonly permissions: Permissions = NoPermissions,
    public $midiSystemEvents: SystemEvents | object = {},
  ) {
    this._tracks = tracks;
    this._audioFiles = audioFiles;
    this._warpMarkers = warpMarkers;

    this._tracks.forEach((track, i) => track.mixer.index = i);
    this._syncPlayerMode();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────────

  private async _save(fields: PbRecord): Promise<PbRecord> {
    return dbUpdate("songs", this.id, fields);
  }

  private _serializeTracks(): any[] {
    return this._tracks.map(t => t.serialize());
  }

  private _serializeMeasures(): any[] {
    return this.measures.items().map(m => m.serialize());
  }

  private _syncPlayerMode(): void {
    if (this.midiFile) {
      this.playerMode = "midi";
    } else if (this._audioFiles.length > 0) {
      this.playerMode = "audio";
    } else {
      this.playerMode = "none";
    }
  }

  private _updateEffectiveParameters(): void {
    const soloing = this._tracks.some(track => track.mixer.solo);
    this._tracks.forEach(track => track.mixer.effectiveMute = soloing ? !track.mixer.solo : track.mixer.mute);
    this._tracks.forEach(track => track.mixer.effectiveGain = track.mixer.effectiveMute ? 0.0 : track.mixer.gain);
  }

  // ── Measure lookup ────────────────────────────────────────────────────────────

  public findMeasureIndex(value: Numbering, ignoreRepeats: boolean = false): number {
    if (ignoreRepeats && value.includes("-")) {
      value = value.split("-")[0] + "-1";
    }

    return this.measures.searchIndex({ value } as Measure);
  }

  public findMeasure(value: Numbering, ignoreRepeats: boolean = false): Measure | undefined {
    return this.measures.items()[this.findMeasureIndex(value, ignoreRepeats)];
  }

  public findMeasureByTick(tick: Tick): Measure | undefined {
    const index = binarySearch<number, Measure>(this.measures.items(), tick, {
      comparator: (tick, measure) => tick - (measure.$beatTicks[0] ?? Infinity),
      direction: "backward",
      inclusive: true,
      extend: true,
    });
    return this.measures.items()[index];
  }

  // ── Mixer (in-memory only, not persisted) ─────────────────────────────────────

  public setTrackMute(trackIndex: number, value: boolean): void {
    if (!this._tracks[trackIndex]) {
      console.warn(`setTrackMute: track index ${trackIndex} out of range.`);
      return;
    }

    this._tracks[trackIndex]!.mixer.mute = value;
    this._updateEffectiveParameters();
  }

  public setTrackSolo(trackIndex: number, value: boolean): void {
    if (!this._tracks[trackIndex]) {
      console.warn(`setTrackSolo: track index ${trackIndex} out of range.`);
      return;
    }

    this._tracks[trackIndex]!.mixer.solo = value;
    this._updateEffectiveParameters();
  }

  public setTrackHighlight(trackIndex: number, value: boolean): void {
    if (!this._tracks[trackIndex]) {
      console.warn(`setTrackHighlight: track index ${trackIndex} out of range.`);
      return;
    }

    this._tracks[trackIndex]!.mixer.highlight = value;
  }

  public setTrackGain(trackIndex: number, value: number): void {
    if (!this._tracks[trackIndex]) {
      console.warn(`setTrackGain: track index ${trackIndex} out of range.`);
      return;
    }

    this._tracks[trackIndex]!.mixer.gain = Math.max(0, Math.min(1, value));
    this._updateEffectiveParameters();
  }

  // ── Track mutations ───────────────────────────────────────────────────────────

  public async updateTrackFields(index: number, patch: TrackPatch): Promise<void> {
    const track = this._tracks[index];
    if (!track) {
      console.warn(`updateTrackFields: track index ${index} out of range.`);
      return;
    }

    track._applyPatch(patch);
    await this._save({ tracks: this._serializeTracks() });
  }

  public async addTrack(track: Track): Promise<void> {
    track.mixer.index = this._tracks.length;
    this._tracks.push(track);
    await this._save({ tracks: this._serializeTracks() });
  }

  public async addTracks(tracks: Track[]): Promise<void> {
    for (const track of tracks) {
      track.mixer.index = this._tracks.length;
      this._tracks.push(track);
    }

    await this._save({ tracks: this._serializeTracks() });
  }

  public async removeTrack(index: number): Promise<void> {
    this._tracks.splice(index, 1);
    this._tracks.forEach((t, i) => (t.mixer.index = i));
    await this._save({ tracks: this._serializeTracks() });
  }

  public async moveTrack(fromIndex: number, toIndex: number): Promise<void> {
    const [track] = this._tracks.splice(fromIndex, 1);
    this._tracks.splice(toIndex, 0, track!);
    this._tracks.forEach((t, i) => (t.mixer.index = i));
    await this._save({ tracks: this._serializeTracks() });
  }

  // ── File mutations ────────────────────────────────────────────────────────────

  public async updateDetails({ number, title }: SongDetails): Promise<void> {
    await this._save({ number, title });
    this.number = number;
    this.title = title;
  }

  /**
   * Uploads score, MIDI and recordings in one request. A beat map also fills in the measures and
   * the MIDI tracks while the song has none, so a freshly imported MIDI song is playable at once.
   */
  public async addFiles({ score, midi, beatMap, recordings = [] }: SongFiles): Promise<void> {
    const formData = new FormData();
    const beatMapJson = beatMap ? JSON.parse(await beatMap.text()) : undefined;

    if (score) {
      formData.append("pdfFile", score);
    }

    if (midi) {
      formData.append("midiFile", midi);
    }

    if (beatMap) {
      formData.append("jsonFile", beatMap);
    }

    if (beatMapJson && this.measures.items().length === 0) {
      measuresFromBeatMap(beatMapJson).forEach(measure => this.measures.insert(measure));
      formData.append("measures", JSON.stringify(this._serializeMeasures()));
    }

    if (beatMapJson && this._tracks.length === 0) {
      this._tracks.push(...tracksFromBeatMap(beatMapJson));
      this._tracks.forEach((track, i) => track.mixer.index = i);
      formData.append("tracks", JSON.stringify(this._serializeTracks()));
    }

    if ([...formData.keys()].length === 0) {
      await this.addRecordings(recordings);
      return;
    }

    const record = await dbUpdateWithFiles("songs", this.id, formData);
    this.pdfFile = record.pdfFile || this.pdfFile;
    this.midiFile = record.midiFile || this.midiFile;
    this.jsonFile = record.jsonFile || this.jsonFile;
    this._syncPlayerMode();

    await this.addRecordings(recordings);
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
    await this._save({ pdfFile: null });
    this.pdfFile = undefined;
  }

  // Without its beat map a MIDI file cannot play, so both are always removed together.
  public async removeMidiFile(): Promise<void> {
    this.midiFile = undefined;
    this.jsonFile = undefined;
    this._tracks.splice(0, this._tracks.length);
    this._syncPlayerMode();
    await this._save({ midiFile: null, jsonFile: null, tracks: [] });
  }

  public async uploadAudioFiles(files: File[]): Promise<string[]> {
    if (files.length === 0) {
      return [];
    }

    const prevFilenames = new Set(
      this._audioFiles.map(f => (typeof f === "string" ? f : f.name)),
    );

    const formData = new FormData();

    // Without the "+" modifier PocketBase replaces all existing audio files, orphaning their tracks.
    for (const file of files) {
      formData.append("audioFiles+", file);
    }

    const record = await dbUpdateWithFiles("songs", this.id, formData);
    const newFilenames = (record.audioFiles as string[]).filter(f => !prevFilenames.has(f));

    for (const filename of newFilenames) {
      this._audioFiles.push(filename);
    }

    this._syncPlayerMode();

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
    const idx = this._audioFiles.findIndex(
      f => (typeof f === "string" ? f : f.name) === filename,
    );
    if (idx !== -1) {
      this._audioFiles.splice(idx, 1);
    }

    for (let i = this._tracks.length - 1; i >= 0; i--) {
      if (this._tracks[i]!.audioFile === filename) {
        this._tracks.splice(i, 1);
      }
    }

    this._tracks.forEach((t, i) => (t.mixer.index = i));
    this._syncPlayerMode();
    await this._save({ tracks: this._serializeTracks() });
  }

  // ── Measure mutations ─────────────────────────────────────────────────────────

  public async addMeasure(measure: Measure): Promise<void> {
    this.measures.insert(measure);
    await this._save({ measures: this._serializeMeasures() });
  }

  public async addMeasures(measures: Measure[]): Promise<void> {
    for (const measure of measures) {
      this.measures.insert(measure);
    }

    await this._save({ measures: this._serializeMeasures() });
  }

  public async removeMeasure(measure: Measure): Promise<void> {
    this.measures.remove(measure);
    await this._save({ measures: this._serializeMeasures() });
  }

  public async setMeasureBeats(measure: Measure, n: number): Promise<void> {
    measure._applyBeats(n);
    await this._save({ measures: this._serializeMeasures() });
  }

  public applyMeasureLayout(measure: Measure, layout: MeasureLayout | undefined): void {
    measure._applyLayout(layout);
  }

  /**
   * Moves the layout of a measure to the measure with the given number. If that measure already
   * has a layout, the two layouts swap, so a mislabelled box can be fixed in one step.
   */
  public async reassignMeasureLayout(measure: Measure, targetValue: Numbering): Promise<void> {
    const target = this.measures.items().find(m => m.value === targetValue);
    if (!target || target === measure) {
      return;
    }

    const targetLayout = target.layout;
    target._applyLayout(measure.layout);
    measure._applyLayout(targetLayout);
    await this.saveMeasures();
  }

  public async saveMeasures(): Promise<void> {
    await this._save({ measures: this._serializeMeasures() });
  }

  // ── Warp marker mutations ─────────────────────────────────────────────────────

  public async addWarpMarker(marker: SongWarpMarker): Promise<void> {
    this._warpMarkers.push(marker);
    this._warpMarkers.sort((a, b) => a.time - b.time);
    await this._save({ warpMarkers: this._warpMarkers });
  }

  public async removeWarpMarker(measure: Numbering): Promise<void> {
    const idx = this._warpMarkers.findIndex(m => m.measure === measure);
    if (idx !== -1) {
      this._warpMarkers.splice(idx, 1);
    }

    await this._save({ warpMarkers: this._warpMarkers });
  }

  public async setWarpMarker(measure: Numbering, time: number): Promise<void> {
    const marker = this._warpMarkers.find(m => m.measure === measure);
    if (marker) {
      marker.time = time;
    }

    await this._save({ warpMarkers: this._warpMarkers });
  }

  // ── Serialization & persistence ───────────────────────────────────────────────

  public serialize(): PbRecord {
    return {
      number: this.number,
      title: this.title,
      midiFile: this.midiFile,
      jsonFile: this.jsonFile,
      pdfFile: this.pdfFile,
      audioFiles: this._audioFiles,
      tracks: this._serializeTracks(),
      measures: this._serializeMeasures(),
      events: {
        markers: this.events.markers.items().map(m => m.serialize()),
        vamps: this.events.vamps.items().map(v => v.serialize()),
        segue: this.events.segue,
      },
      warpMarkers: this._warpMarkers,
    };
  }

  public static deserialize({ id, number, title, midiFile, jsonFile, pdfFile, audioFiles, tracks, measures, events, warpMarkers }: PbRecord, showPermissions?: Permissions): Song {
    const measureList = new MeasureList(measures.map((m: PbRecord) => Measure.deserialize(m)));

    // Convert all warp markers from using indices to using measure numbers
    const songWarpMarkers = ((warpMarkers ?? []) as (WarpMarker | SongWarpMarker)[]).map(m => ({
      measure: typeof m.measure === "number" ? (measureList.items()[m.measure]?.value ?? String(m.measure)) : m.measure,
      time: m.time,
    }));

    return new Song(
      id,
      number,
      title,
      midiFile,
      jsonFile,
      pdfFile,
      audioFiles,
      tracks.map((t: PbRecord) => Track.deserialize(t)),
      measureList,
      {
        markers: new MeasureEventList<MarkerEvent>(events.markers.map((m: PbRecord) => MarkerEvent.deserialize(m))),
        vamps: new MeasureEventList<VampEvent>(events.vamps.map((v: PbRecord) => VampEvent.deserialize(v))),
        segue: events.segue,
      },
      songWarpMarkers,
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
    formData.append("measures", "[]");
    formData.append("events", JSON.stringify(EMPTY_EVENTS));
    formData.append("warpMarkers", "[]");

    const record = await dbCreateWithFiles("songs", formData);
    const song = Song.deserialize({ ...record, tracks: [], measures: [], events: EMPTY_EVENTS, warpMarkers: [] }, permissions);
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
