import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type Permissions } from "@/pocketbase/auth";

import type { MidiSystemEvents } from "../midi/player";
import type { Tick } from "../midi/types";
import { binarySearch } from "../utils/binarySearch";
import type { UrlOrFile } from "../utils/file";
import type { Numbering } from "../utils/numbering";
import Measure, { MeasureList } from "./measure";
import { MarkerEvent, MeasureEventList, VampEvent } from "./measureEvent";
import Track from "./track";

export type SongNumber = Numbering;

export type SongEvents = {
  markers: MeasureEventList<MarkerEvent>;
  vamps: MeasureEventList<VampEvent>;
  segue: boolean;
};

export default class Song {
  constructor(
    public readonly id: string,
    public number: Numbering,
    public title: string,
    public midiFile?: UrlOrFile,
    public jsonFile?: UrlOrFile,
    public pdfFile?: UrlOrFile,
    public tracks: Track[] = [],
    public measures: MeasureList = new MeasureList(),
    public events: SongEvents = {
      markers: new MeasureEventList<MarkerEvent>(),
      vamps: new MeasureEventList<VampEvent>(),
      segue: false,
    },
    public permissions: Permissions = NoPermissions,
    public $midiSystemEvents: MidiSystemEvents | object = {},
  ) {
    // set track indices
    this.tracks.forEach((track, i) => track.mixer.index = i);
  }

  public findMeasureIndex(value: Numbering, ignoreRepeats: boolean = false): number {
    if (ignoreRepeats && value.includes("-")) {
      value = value.split("-")[0] + "-1";
    }

    return this.measures.searchIndex({ value } as Measure);
  }

  public findMeasure(value: Numbering, ignoreRepeats: boolean = false): Measure | undefined {
    return this.measures.items()[this.findMeasureIndex(value, ignoreRepeats)];
  }

  // public findFollowingMeasure(value: Numbering, ignoreRepeats: boolean = false): Measure {
  //   // TODO: Use more complex logic to handle repeats
  //   const i = this.findMeasureIndex(value, ignoreRepeats);
  //   return this.measures.items()[i + 1] ?? this.measures.last();
  // }

  // public findPreceedingMeasure(value: Numbering, ignoreRepeats: boolean = false): Measure {
  //   // TODO: Use more complex logic to handle repeats
  //   const i = this.findMeasureIndex(value, ignoreRepeats);
  //   return this.measures.items()[i - 1] ?? this.measures.first();
  // }

  public findMeasureByTick(tick: Tick): Measure | undefined {
    const index = binarySearch<number, Measure>(this.measures.items(), tick, {
      comparator: (tick, measure) => tick - (measure.$beatTicks[0] ?? Infinity),
      direction: "backward",
      inclusive: true,
      extend: true,
    });
    return this.measures.items()[index];
  }

  private _updateEffectiveParameters(): void {
    const soloing = this.tracks.some(track => track.mixer.solo);

    this.tracks.forEach(track => track.mixer.effectiveMute = soloing ? !track.mixer.solo : track.mixer.mute);
    this.tracks.forEach(track => track.mixer.effectiveGain = track.mixer.effectiveMute ? 0.0 : track.mixer.gain);
  }

  public setTrackMute(trackIndex: number, value: boolean): void {
    if (!this.tracks[trackIndex]) {
      console.warn(`setTrackMute: track index ${trackIndex} out of range.`);
      return;
    }

    this.tracks[trackIndex]!.mixer.mute = value;
    this._updateEffectiveParameters();
  }

  public setTrackSolo(trackIndex: number, value: boolean): void {
    if (!this.tracks[trackIndex]) {
      console.warn(`setTrackSolo: track index ${trackIndex} out of range.`);
      return;
    }

    this.tracks[trackIndex]!.mixer.solo = value;
    this._updateEffectiveParameters();
  }

  public setTrackHighlight(trackIndex: number, value: boolean): void {
    if (!this.tracks[trackIndex]) {
      console.warn(`setTrackHighlight: track index ${trackIndex} out of range.`);
      return;
    }

    this.tracks[trackIndex]!.mixer.highlight = value;
  }

  public setTrackGain(trackIndex: number, value: number): void {
    if (!this.tracks[trackIndex]) {
      console.warn(`setTrackGain: track index ${trackIndex} out of range.`);
      return;
    }

    this.tracks[trackIndex]!.mixer.gain = Math.max(0, Math.min(1, value));
    this._updateEffectiveParameters();
  }

  public toRecord(): PbRecord {
    return {
      number: this.number,
      title: this.title,
      midiFile: this.midiFile,
      jsonFile: this.jsonFile,
      pdfFile: this.pdfFile,
      tracks: this.tracks.map(t => t.json()),
      measures: this.measures.items().map(m => m.json()),
      events: {
        markers: this.events.markers.items().map(m => m.json()),
        vamps: this.events.vamps.items().map(v => v.json()),
        segue: this.events.segue,
      },
    };
  }

  public static fromRecord({ id, number, title, midiFile, jsonFile, pdfFile, tracks, measures, events }: PbRecord, showPermissions?: Permissions): Song {
    return new Song(
      id,
      number,
      title,
      midiFile,
      jsonFile,
      pdfFile,
      tracks.map((t: PbRecord) => Track.fromJson(t)),
      new MeasureList(measures.map((m: PbRecord) => Measure.fromJson(m))),
      {
        markers: new MeasureEventList<MarkerEvent>(events.markers.map((m: PbRecord) => MarkerEvent.fromJson(m))),
        vamps: new MeasureEventList<VampEvent>(events.vamps.map((v: PbRecord) => VampEvent.fromJson(v))),
        segue: events.segue,
      },
      showPermissions ?? NoPermissions,
    );
  }

  public async create(): Promise<PbRecord> {
    return await pb.collection("songs").create(this.toRecord());
  }

  public async update(): Promise<PbRecord> {
    return await pb.collection("songs").update(this.id, this.toRecord());
  }

  public static async list(): Promise<Song[]> {
    const records = await pb.collection("songs").getFullList();
    return records.map(record => Song.fromRecord(record));
  }

  public static async get(id: string): Promise<Song> {
    const record = await pb.collection("songs").getOne(id);
    return Song.fromRecord(record);
  }
}
