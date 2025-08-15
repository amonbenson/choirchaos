import type { UrlOrFile } from "../utils/file";
import Song from "./song";

export default class Show {
  public id: string;
  public title: string = "";
  public thumbnail?: UrlOrFile;
  public songs: Song[] = [];

  constructor(id: string) {
    this.id = id;
  }

  public json() {
    return {
      id: this.id,
      title: this.title,
      thumbnail: this.thumbnail,
      songs: this.songs.map(s => s.json()),
    };
  }
}
