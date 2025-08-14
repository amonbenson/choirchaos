import Track from "./track";
import Measure from "./measure";
import type { Numbering } from "../utils/numbering";
import type { MarkerEvent, VampEvent } from "./measureEvent";

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
  public midiFileUrl?: string;
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
}
