import { pb, type PbRecord } from "@/pocketbase";
import { getAccessFlags, NoPermissions, type Permissions, type UserAccess, type Visibility } from "@/pocketbase/auth";
import { dbCreateWithFiles, dbDelete, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";

import type { UrlOrFile } from "../utils/file";
import { compareNumberings } from "../utils/numbering";
import Song from "./song";

export type MemberRole = "owner" | "editor" | "viewer";

export type ShowMember = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: MemberRole;
};

const MEMBERS_ROUTE = (showId: string): string => `/api/choirchaos/shows/${showId}/members`;

export default class Show {
  constructor(
    public readonly id: string,
    public title: string,
    public thumbnail?: UrlOrFile,
    public readonly songs: Song[] = [],
    public permissions: Permissions = NoPermissions,
    private songCount: number = songs.length,
  ) {
    this.sortSongs();
  }

  public getSongCount(): number {
    return Math.max(this.songCount, this.songs.length);
  }

  public getAccess(userId?: string): UserAccess {
    return getAccessFlags(this.permissions, userId);
  }

  public getRole(userId?: string): MemberRole | undefined {
    if (!userId) {
      return undefined;
    }

    if (this.permissions.owner === userId) {
      return "owner";
    }

    if (this.permissions.editors.includes(userId)) {
      return "editor";
    }

    return this.permissions.viewers.includes(userId) ? "viewer" : undefined;
  }

  public sortSongs(): void {
    this.songs.sort((a, b) => compareNumberings(a.number, b.number));
  }

  public serialize(): PbRecord {
    const { title, thumbnail, permissions } = this;

    return {
      title,
      thumbnail,
      ...permissions,
    };
  }

  public static deserialize({ id, title, thumbnail, expand, owner, editors, viewers, visibility }: PbRecord): Show {
    const permissions = {
      owner,
      editors: editors ?? [],
      viewers: viewers ?? [],
      visibility,
    };
    const songRecords: PbRecord[] = expand?.songs_via_show ?? [];
    const hasFullSongs = songRecords.every(record => record.score !== undefined);

    return new Show(
      id,
      title,
      thumbnail || undefined,
      hasFullSongs ? songRecords.map(record => Song.deserialize(record, permissions)) : [],
      permissions,
      songRecords.length,
    );
  }

  public static async list(): Promise<Show[]> {
    // Only the song ids are needed for the counts on the home page, not the full song data.
    const records = await pb.collection("shows").getFullList({
      expand: "songs_via_show",
      fields: "*,expand.songs_via_show.id",
      sort: "title",
    });
    return records.map(record => Show.deserialize(record));
  }

  public static async get(id: string): Promise<Show> {
    const record = await pb.collection("shows").getOne(id, {
      expand: "songs_via_show",
    });
    return Show.deserialize(record);
  }

  public static async create(title: string, ownerId: string, thumbnail?: File): Promise<Show> {
    const formData = new FormData();
    formData.append("title", title);
    formData.append("owner", ownerId);
    formData.append("visibility", "private");

    if (thumbnail) {
      formData.append("thumbnail", thumbnail);
    }

    return Show.deserialize(await dbCreateWithFiles("shows", formData));
  }

  public async updateTitle(title: string): Promise<void> {
    await dbUpdate("shows", this.id, { title });
    this.title = title;
  }

  public async updateThumbnail(thumbnail: File | undefined): Promise<void> {
    const formData = new FormData();
    formData.append("thumbnail", thumbnail ?? "");
    const record = await dbUpdateWithFiles("shows", this.id, formData);
    this.thumbnail = record.thumbnail || undefined;
  }

  public async setVisibility(visibility: Visibility): Promise<void> {
    await dbUpdate("shows", this.id, { visibility });
    this.permissions = { ...this.permissions, visibility };
  }

  public async setMemberRole(userId: string, role: "editor" | "viewer"): Promise<void> {
    const editors = this.permissions.editors.filter(id => id !== userId);
    const viewers = this.permissions.viewers.filter(id => id !== userId);
    (role === "editor" ? editors : viewers).push(userId);
    await this.saveMembers(editors, viewers);
  }

  public async removeMember(userId: string): Promise<void> {
    await this.saveMembers(
      this.permissions.editors.filter(id => id !== userId),
      this.permissions.viewers.filter(id => id !== userId),
    );
  }

  private async saveMembers(editors: string[], viewers: string[]): Promise<void> {
    await dbUpdate("shows", this.id, { editors, viewers });
    this.permissions = { ...this.permissions, editors, viewers };
  }

  // Users can only read their own record, so names and avatars come from a backend route.
  public async getMembers(): Promise<ShowMember[]> {
    return await pb.send(MEMBERS_ROUTE(this.id), { method: "GET" });
  }

  public async addMember(email: string, role: "editor" | "viewer"): Promise<ShowMember[]> {
    const members: ShowMember[] = await pb.send(MEMBERS_ROUTE(this.id), { method: "POST", body: { email, role } });
    this.permissions = {
      ...this.permissions,
      editors: members.filter(m => m.role === "editor").map(m => m.id),
      viewers: members.filter(m => m.role === "viewer").map(m => m.id),
    };
    return members;
  }

  public addSong(song: Song): void {
    this.songs.push(song);
    this.songCount = this.songs.length;
    this.sortSongs();
  }

  public async deleteSong(song: Song): Promise<void> {
    await song.delete();
    this.songs.splice(this.songs.indexOf(song), 1);
    this.songCount = this.songs.length;
  }

  // Songs require their show, so they are deleted first. This also works without cascade delete.
  public async delete(): Promise<void> {
    const songIds = this.songs.length > 0
      ? this.songs.map(song => song.id)
      : (await Show.get(this.id)).songs.map(song => song.id);

    for (const songId of songIds) {
      await dbDelete("songs", songId);
    }

    await dbDelete("shows", this.id);
  }
}
