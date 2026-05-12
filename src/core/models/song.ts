import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type Permissions } from "@/pocketbase/auth";
import { dbCreate, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";

import type { MidiSystemEvents, PlayerMode } from "../midi/player";
import type { Tick } from "../midi/types";
import type { WarpMarker } from "../midi/warp";
import { binarySearch } from "../utils/binarySearch";
import type { UrlOrFile } from "../utils/file";
import type { Numbering } from "../utils/numbering";
import Measure, { type MeasureLayout, MeasureList } from "./measure";
import { MarkerEvent, MeasureEventList, VampEvent } from "./measureEvent";
import Track, { type TrackPatch } from "./track";

export type SongNumber = Numbering;

export type SongEvents = {
  markers: MeasureEventList<MarkerEvent>;
  vamps: MeasureEventList<VampEvent>;
  segue: boolean;
};

export default class Song {
  public playerMode: PlayerMode = "none";

  private readonly _tracks: Track[];
  private readonly _audioFiles: UrlOrFile[];
  private readonly _warpMarkers: WarpMarker[];

  get tracks(): readonly Track[] {
    return this._tracks;
  }

  get audioFiles(): readonly UrlOrFile[] {
    return this._audioFiles;
  }

  get warpMarkers(): readonly WarpMarker[] {
    return this._warpMarkers;
  }

  constructor(
    public readonly id: string,
    public readonly number: Numbering,
    public readonly title: string,
    public readonly midiFile: UrlOrFile | undefined,
    public readonly jsonFile: UrlOrFile | undefined,
    public readonly pdfFile: UrlOrFile | undefined,
    audioFiles: UrlOrFile[] = [],
    tracks: Track[] = [],
    public readonly measures: MeasureList = new MeasureList(),
    public readonly events: SongEvents = {
      markers: new MeasureEventList<MarkerEvent>(),
      vamps: new MeasureEventList<VampEvent>(),
      segue: false,
    },
    warpMarkers: WarpMarker[] = [],
    public readonly permissions: Permissions = NoPermissions,
    public $midiSystemEvents: MidiSystemEvents | object = {},
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

  public async uploadMidiFile(file: File): Promise<void> {
    const formData = new FormData();
    formData.append("midiFile", file);
    const record = await dbUpdateWithFiles("songs", this.id, formData);
    (this as any).midiFile = record.midiFile;
    this._syncPlayerMode();
  }

  public async removeMidiFile(): Promise<void> {
    (this as any).midiFile = undefined;
    this._tracks.splice(0, this._tracks.length);
    this._syncPlayerMode();
    await this._save({ midiFile: null, tracks: [] });
  }

  public async uploadAudioFile(file: File): Promise<string> {
    const prevFilenames = new Set(
      this._audioFiles.map(f => (typeof f === "string" ? f : f.name)),
    );
    const formData = new FormData();
    formData.append("audioFiles", file);
    const record = await dbUpdateWithFiles("songs", this.id, formData);
    const newFilename = (record.audioFiles as string[]).find(f => !prevFilenames.has(f));
    if (!newFilename) {
      throw new Error("File upload failed: could not determine uploaded filename");
    }

    this._audioFiles.push(newFilename);
    this._syncPlayerMode();
    return newFilename;
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

  public async saveMeasures(): Promise<void> {
    await this._save({ measures: this._serializeMeasures() });
  }

  // ── Warp marker mutations ─────────────────────────────────────────────────────

  public async addWarpMarker(marker: WarpMarker): Promise<void> {
    this._warpMarkers.push(marker);
    this._warpMarkers.sort((a, b) => a.measure - b.measure);
    await this._save({ warpMarkers: this._warpMarkers });
  }

  public async removeWarpMarker(measureIndex: number): Promise<void> {
    const idx = this._warpMarkers.findIndex(m => m.measure === measureIndex);
    if (idx !== -1) {
      this._warpMarkers.splice(idx, 1);
    }

    await this._save({ warpMarkers: this._warpMarkers });
  }

  public async setWarpMarker(measureIndex: number, time: number): Promise<void> {
    const marker = this._warpMarkers.find(m => m.measure === measureIndex);
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
    return new Song(
      id,
      number,
      title,
      midiFile,
      jsonFile,
      pdfFile,
      audioFiles,
      tracks.map((t: PbRecord) => Track.deserialize(t)),
      new MeasureList(measures.map((m: PbRecord) => Measure.deserialize(m))),
      {
        markers: new MeasureEventList<MarkerEvent>(events.markers.map((m: PbRecord) => MarkerEvent.deserialize(m))),
        vamps: new MeasureEventList<VampEvent>(events.vamps.map((v: PbRecord) => VampEvent.deserialize(v))),
        segue: events.segue,
      },
      warpMarkers,
      showPermissions ?? NoPermissions,
    );
  }

  public async create(): Promise<PbRecord> {
    return await dbCreate("songs", this.serialize());
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
