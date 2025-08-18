import Track from "./track";
import Measure, { MeasureList } from "./measure";
import type { Numbering } from "../utils/numbering";
import { MarkerEvent, MeasureEventList, VampEvent } from "./measureEvent";
import type { UrlOrFile } from "../utils/file";
import { pb, type PbRecord } from "@/pocketbase";
import type { MidiSystemEvents } from "./midiPlayer";

export type SongNumber = Numbering;

export type SongEvents = {
  markers: MeasureEventList<MarkerEvent>;
  vamps: MeasureEventList<VampEvent>;
  segue: boolean;
}

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
    public $midiSystemEvents: MidiSystemEvents | object = {},
  ) {}

  public findMeasure(value: Numbering) {
    return this.measures.search({ value } as Measure);
  }

  public findFollowingMeasure(value: Numbering) {
    const i = this.measures.searchIndex({ value } as Measure);
    return this.measures.items()[i + 1] ?? this.measures.last();
  }

  public findPreceedingMeasure(value: Numbering) {
    const i = this.measures.searchIndex({ value } as Measure);
    return this.measures.items()[i - 1] ?? this.measures.first();
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

  public static fromRecord({ id, number, title, midiFile, jsonFile, pdfFile, tracks, measures, events }: PbRecord): Song {
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
