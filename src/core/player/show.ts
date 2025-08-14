import Song from "./song";

export default class Show {
  public id: string;
  public title: string = "";
  public thumbnailUrl?: string;
  public songs: Song[] = [];

  constructor(id: string) {
    this.id = id;
  }
}
