import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type PermissionContext } from "@/pocketbase/auth";

import type { UrlOrFile } from "../utils/file";
import { compareNumberings } from "../utils/numbering";
import Song from "./song";

export default class Show {
  constructor(
    public readonly id: string,
    public title: string,
    public thumbnail?: UrlOrFile,
    public songs: Song[] = [],

    public permissions: PermissionContext = NoPermissions,
  ) {
    this.songs.sort((a, b) => compareNumberings(a.number, b.number));
  }

  public toRecord(): PbRecord {
    const { title, thumbnail, songs: _, permissions } = this;

    return {
      title,
      thumbnail,
      ...permissions,
    };
  }

  public static fromRecord({ id, title, thumbnail, expand, owner, editors, viewers, visibility }: PbRecord): Show {
    const permissions = {
      owner,
      editors,
      viewers,
      visibility,
    };

    return new Show(
      id,
      title,
      thumbnail,
      expand?.songs_via_show?.map((s: Song) => Song.fromRecord(s, permissions)) ?? [],
      permissions,
    );
  }

  public async create(): Promise<PbRecord> {
    return await pb.collection("shows").create(this.toRecord());
  }

  public async update(): Promise<PbRecord> {
    return await pb.collection("shows").update(this.id, this.toRecord());
  }

  public static async list(): Promise<Show[]> {
    const records = await pb.collection("shows").getFullList();
    return records.map(record => Show.fromRecord(record));
  }

  public static async get(id: string): Promise<Show> {
    const record = await pb.collection("shows").getOne(id, {
      expand: "songs_via_show",
    });
    return Show.fromRecord(record);
  }
}
