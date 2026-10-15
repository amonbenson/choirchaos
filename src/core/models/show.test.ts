import { afterEach, describe, expect, it, vi } from "vitest";

import { dbDelete, dbUpdate } from "@/pocketbase/db";

import Show from "./show";

vi.mock("@/pocketbase/db", () => ({
  dbCreateWithFiles: vi.fn(),
  dbDelete: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

const SONG_RECORD = {
  number: "1",
  title: "Song",
  audioFiles: [],
  tracks: [],
  measures: [],
  events: { markers: [], vamps: [], segue: false },
  warpMarkers: [],
};

function makeShow(): Show {
  return Show.deserialize({
    id: "show-id",
    title: "Show",
    owner: "owner",
    editors: ["editor"],
    viewers: ["viewer"],
    visibility: "private",
    expand: { songs_via_show: [{ ...SONG_RECORD, id: "b", number: "2" }, { ...SONG_RECORD, id: "a" }] },
  });
}

describe("Show", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sorts songs by number", () => {
    expect(makeShow().songs.map(s => s.id)).toEqual(["a", "b"]);
  });

  it("counts songs from an id-only expand without building songs", () => {
    const show = Show.deserialize({ id: "s", title: "S", owner: "o", visibility: "public", expand: { songs_via_show: [{ id: "1" }, { id: "2" }] } });

    expect(show.songs).toEqual([]);
    expect(show.getSongCount()).toBe(2);
    expect(show.permissions.editors).toEqual([]);
  });

  it("reports the role of a user", () => {
    const show = makeShow();

    expect(["owner", "editor", "viewer", "stranger", undefined].map(id => show.getRole(id))).toEqual(["owner", "editor", "viewer", undefined, undefined]);
  });

  it("moves a member between roles", async () => {
    const show = makeShow();

    await show.setMemberRole("viewer", "editor");

    expect(dbUpdate).toHaveBeenCalledWith("shows", "show-id", { editors: ["editor", "viewer"], viewers: [] });
    expect(show.getRole("viewer")).toBe("editor");
  });

  it("removes a member", async () => {
    const show = makeShow();

    await show.removeMember("editor");

    expect(show.permissions).toMatchObject({ editors: [], viewers: ["viewer"] });
  });

  it("deletes all songs before the show", async () => {
    await makeShow().delete();

    expect(vi.mocked(dbDelete).mock.calls).toEqual([["songs", "a"], ["songs", "b"], ["shows", "show-id"]]);
  });
});
