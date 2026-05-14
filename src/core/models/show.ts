import { pb, type PbRecord } from "@/pocketbase";
import { NoPermissions, type Permissions } from "@/pocketbase/auth";
import { dbCreate, dbUpdate } from "@/pocketbase/db";

import type { UrlOrFile } from "../utils/file";
import { compareNumberings } from "../utils/numbering";
import Song from "./song";

export default class Show {
  constructor(
    public readonly id: string,
    public title: string,
    public thumbnail?: UrlOrFile,
    public readonly songs: Song[] = [],

    public permissions: Permissions = NoPermissions,
  ) {
    this.songs.sort((a, b) => compareNumberings(a.number, b.number));
  }

  public serialize(): PbRecord {
    const { title, thumbnail, songs: _, permissions } = this;

    return {
      title,
      thumbnail,
      ...permissions,
    };
  }

  public static deserialize({ id, title, thumbnail, expand, owner, editors, viewers, visibility }: PbRecord): Show {
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
      expand?.songs_via_show?.map((s: Song) => Song.deserialize(s, permissions)) ?? [],
      permissions,
    );
  }

  public async create(): Promise<PbRecord> {
    return await dbCreate("shows", this.serialize());
  }

  public async update(): Promise<PbRecord> {
    return await dbUpdate("shows", this.id, this.serialize());
  }

  public static async list(): Promise<Show[]> {
    const records = await pb.collection("shows").getFullList();
    return records.map(record => Show.deserialize(record));
  }

  public static async get(id: string): Promise<Show> {
    const record = await pb.collection("shows").getOne(id, {
      expand: "songs_via_show",
    });
    return Show.deserialize(record);
  }
}
