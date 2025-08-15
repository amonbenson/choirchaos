import Track from "./track";
import Measure from "./measure";
import type { Numbering } from "../utils/numbering";
import type { MarkerEvent, VampEvent } from "./measureEvent";
import type { UrlOrFile } from "../utils/file";

export type SongNumber = Numbering;

export type SongEvents = {
  markers: MarkerEvent[];
  vamps: VampEvent[];
  segue: boolean;
}

export default class Song {
  public id: string;
  public number: SongNumber;
  public title: string = "";
  public midiFileUrl?: UrlOrFile;
  public jsonFileUrl?: UrlOrFile;
  public tracks: Track[] = [];
  public measures: Measure[] = [];
  public events: SongEvents = {
    markers: [],
    vamps: [],
    segue: false,
  };

  constructor(id: string, number: Numbering) {
    this.id = id;
    this.number = number;
  }

  public json() {
    return {
      id: this.id,
      number: this.number,
      title: this.title,
      midiFileUrl: this.midiFileUrl,
      jsonFileUrl: this.jsonFileUrl,
      tracks: this.tracks.map(t => t.json()),
      measures: this.measures.map(m => m.json()),
      events: {
        markers: this.events.markers.map(m => m.json()),
        vamps: this.events.vamps.map(v => v.json()),
        segue: this.events.segue,
      },
    };
  }
}
