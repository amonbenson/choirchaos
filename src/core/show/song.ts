import Track from "./track";
import Measure from "./measure";
import { compareNumberings, type Numbering } from "../utils/numbering";
import { MarkerEvent, VampEvent } from "./measureEvent";
import type { UrlOrFile } from "../utils/file";
import { pb, type PbRecord } from "@/pocketbase";
import type { MeasureEvent, MidiEventList, TempoEvent, TimeSignatureEvent } from "./midiEvents";

export type SongNumber = Numbering;

export type SongEvents = {
  markers: MarkerEvent[];
  vamps: VampEvent[];
  segue: boolean;
}

export default class Song {
  constructor(
    public readonly id: string,
    public number: Numbering,
    public title: string,
    public midiFile?: UrlOrFile,
    public jsonFile?: UrlOrFile,
    public tracks: Track[] = [],
    public measures: Measure[] = [],
    public events: SongEvents = {
      markers: [],
      vamps: [],
      segue: false,
    },
    public $midiSystemEvents?: {
      measure: MidiEventList<MeasureEvent>;
      tempo: MidiEventList<TempoEvent>;
      timeSignature: MidiEventList<TimeSignatureEvent>;
    },
  ) {
    this.measures.sort((a, b) => compareNumberings(a.number, b.number));
  }

  public toRecord(): PbRecord {
    return {
      number: this.number,
      title: this.title,
      midiFile: this.midiFile,
      jsonFile: this.jsonFile,
      tracks: this.tracks.map(t => t.json()),
      measures: this.measures.map(m => m.json()),
      events: {
        markers: this.events.markers.map(m => m.json()),
        vamps: this.events.vamps.map(v => v.json()),
        segue: this.events.segue,
      },
    };
  }

  public static fromRecord({ id, number, title, midiFile, jsonFile, tracks, measures, events }: PbRecord): Song {
    return new Song(
      id,
      number,
      title,
      midiFile,
      jsonFile,
      tracks.map((t: PbRecord) => Track.fromJson(t)),
      measures.map((r: PbRecord) => Measure.fromJson(r)),
      {
        markers: events.markers.map((m: PbRecord) => MarkerEvent.fromJson(m)),
        vamps: events.vamps.map((v: PbRecord) => VampEvent.fromJson(v)),
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
