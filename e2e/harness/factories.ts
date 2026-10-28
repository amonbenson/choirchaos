import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";

import { DEFAULT_USER_PASSWORD } from "../config";
import type { SongBundle } from "../generators/song";
import { createClient } from "./backend";

export type TestUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  record: RecordModel;
};

export type CreateUserOptions = {
  name?: string;
  email?: string;
  password?: string;
};

export type Visibility = "private" | "unlisted" | "public";

export type CreateShowOptions = {
  title?: string;
  visibility?: Visibility;
  editors?: TestUser[];
  viewers?: TestUser[];
};

export type Factory = {
  createUser: (options?: CreateUserOptions) => Promise<TestUser>;
  clientFor: (user: TestUser) => Promise<PocketBase>;
  createShow: (owner: TestUser, options?: CreateShowOptions) => Promise<RecordModel>;
  createSong: (actor: TestUser, show: RecordModel, bundle: SongBundle) => Promise<RecordModel>;
};

function toFormData(fields: Record<string, unknown>, files: Record<string, File | File[] | undefined>): FormData {
  const form = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  for (const [key, value] of Object.entries(files)) {
    for (const file of [value ?? []].flat()) {
      form.append(key, file);
    }
  }

  return form;
}

/**
 * Creates records through the public API as a regular user wherever possible, so that access
 * rules apply exactly as they do for the frontend. Only user accounts are created by the superuser.
 */
export function createFactory(backendUrl: string, admin: PocketBase): Factory {
  let userCounter = 0;

  const createUser = async (options: CreateUserOptions = {}): Promise<TestUser> => {
    userCounter++;
    const name = options.name ?? `Test User ${userCounter}`;
    const email = options.email ?? `user${userCounter}@choirchaos.test`;
    const password = options.password ?? DEFAULT_USER_PASSWORD;

    const record = await admin.collection("users").create({
      name,
      email,
      password,
      passwordConfirm: password,
      verified: true,
      emailVisibility: true,
    });

    return { id: record.id, email, password, name, record };
  };

  const clientFor = async (user: TestUser): Promise<PocketBase> => {
    const client = createClient(backendUrl);
    await client.collection("users").authWithPassword(user.email, user.password);
    return client;
  };

  const createShow = async (owner: TestUser, options: CreateShowOptions = {}): Promise<RecordModel> => {
    const client = await clientFor(owner);
    return client.collection("shows").create({
      title: options.title ?? "Test Show",
      visibility: options.visibility ?? "private",
      owner: owner.id,
      editors: (options.editors ?? []).map(user => user.id),
      viewers: (options.viewers ?? []).map(user => user.id),
    });
  };

  /**
   * Uploads a song bundle the way the frontend does: files first, then tracks that refer to the
   * stored audio file names. PocketBase appends a random suffix to every uploaded file name.
   */
  const createSong = async (actor: TestUser, show: RecordModel, bundle: SongBundle): Promise<RecordModel> => {
    const client = await clientFor(actor);
    const { tracks, ...fields } = bundle.fields;
    const { audioFiles, ...singleFiles } = bundle.files;

    const created = await client.collection("songs").create(toFormData(
      { ...fields, show: show.id, tracks: [] },
      { ...singleFiles, audioFiles },
    ));

    if (tracks.length === 0) {
      return created;
    }

    const storedNames = new Map(audioFiles.map((file, index) => [file.name, created.audioFiles[index] as string]));
    const storedTracks = tracks.map(track => ({ ...track, audioFile: storedNames.get(track.audioFile) ?? track.audioFile }));
    return client.collection("songs").update(created.id, { tracks: storedTracks });
  };

  return { createUser, clientFor, createShow, createSong };
}
