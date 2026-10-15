import { afterEach, describe, expect, it, vi } from "vitest";

import { dbCreateWithFiles, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";
import { makeMtiJson } from "@/test/fixtures";

import { isBeatMapFile } from "../midi/beatMap";
import Song from "./song";
import SongDraft from "./songDraft";
import Track from "./track";

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbCreateWithFiles: vi.fn(),
  dbDelete: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(async (_collection: string, id: string) => ({ id })),
}));

function audioSong(): Song {
  return new Song("song-id", "3", "Prologue", undefined, undefined, "score.pdf", ["alto_1.mp3", "bass_2.mp3"], [
    new Track("Alto", "Vocal", 0, "alto_1.mp3"),
    new Track("Bass", "Vocal", 0, "bass_2.mp3"),
  ]);
}

function midiSong(): Song {
  return new Song("song-id", "3", "Prologue", "a.mid", "a.json", undefined, [], [new Track("Lead")]);
}

function beatMapFile(): File {
  return new File([JSON.stringify(makeMtiJson())], "b.json");
}

describe("SongDraft", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts from the song", () => {
    const draft = new SongDraft(audioSong());

    expect([draft.number, draft.title, draft.score, draft.playback]).toEqual(["3", "Prologue", "score.pdf", "audio"]);
    expect(draft.storedRecordings).toEqual([{ filename: "alto_1.mp3", title: "Alto" }, { filename: "bass_2.mp3", title: "Bass" }]);
  });

  it("validates number, title and MIDI files", () => {
    const draft = new SongDraft(undefined, "");
    draft.playback = "midi";
    draft.midi = new File(["m"], "a.mid");

    expect(draft.validate([])).toEqual({
      number: "Use a number like 3 or 3a.",
      title: "Enter a title.",
      playback: "MIDI playback needs a MIDI file and its beat map.",
    });
  });

  it("rejects a number another song uses but allows keeping its own", () => {
    const draft = new SongDraft(audioSong());
    expect(draft.validate(["3", "4"])).toEqual({});

    draft.number = "4";
    expect(draft.validate(["3", "4"]).number).toBe("Song 4 already exists.");
  });

  it("names added recordings after their part", () => {
    const draft = new SongDraft();
    draft.addRecordings([new File(["x"], "03 Prologue - Soprano.mp3"), new File(["x"], "piano.mp3")]);

    expect(draft.newRecordings.map(r => r.title)).toEqual(["Soprano", "Piano"]);
  });

  it("only saves details when nothing else changed", async () => {
    const draft = new SongDraft(audioSong());
    draft.title = "Prologue (new)";

    const { filesChanged } = await draft.save("show-id");

    expect(filesChanged).toBe(false);
    expect(vi.mocked(dbUpdate).mock.calls).toEqual([["songs", "song-id", { number: "3", title: "Prologue (new)" }]]);
    expect(dbUpdateWithFiles).not.toHaveBeenCalled();
  });

  it("removes a single recording", async () => {
    const song = audioSong();
    const draft = new SongDraft(song);
    draft.storedRecordings = draft.storedRecordings.filter(r => r.filename !== "alto_1.mp3");

    const { filesChanged } = await draft.save("show-id");

    expect(filesChanged).toBe(true);
    expect(song.audioFiles).toEqual(["bass_2.mp3"]);
    expect(song.tracks.map(t => t.title)).toEqual(["Bass"]);
  });

  it("removes all recordings before switching to MIDI", async () => {
    const song = audioSong();
    const draft = new SongDraft(song);
    draft.playback = "midi";
    draft.midi = new File(["m"], "a.mid");
    draft.beatMap = beatMapFile();
    expect(draft.getRemovedPlaybackKind()).toBe("recordings");

    await draft.save("show-id");

    expect(song.audioFiles).toEqual([]);
    const uploaded = Array.from(vi.mocked(dbUpdateWithFiles).mock.calls[0]![2].keys());
    expect(uploaded).toEqual(expect.arrayContaining(["midiFile", "jsonFile", "tracks"]));
  });

  it("removes MIDI and its beat map when switching to no playback", async () => {
    const song = midiSong();
    const draft = new SongDraft(song);
    draft.playback = "none";

    await draft.save("show-id");

    expect(dbUpdate).toHaveBeenCalledWith("songs", "song-id", { midiFile: null, jsonFile: null, tracks: [] });
    expect(song.playerMode).toBe("none");
  });

  it("removes the score", async () => {
    const song = audioSong();
    const draft = new SongDraft(song);
    draft.score = undefined;

    await draft.save("show-id");

    expect(dbUpdate).toHaveBeenCalledWith("songs", "song-id", { pdfFile: null });
    expect(song.pdfFile).toBeUndefined();
  });

  it("creates a new song with its files", async () => {
    vi.mocked(dbCreateWithFiles).mockResolvedValueOnce({ id: "new-id", number: "5", title: "New", audioFiles: [] });
    const draft = new SongDraft(undefined, "5");
    draft.title = "New";
    draft.score = new File(["pdf"], "new.pdf");

    const { song } = await draft.save("show-id");

    expect(song.id).toBe("new-id");
    expect(Array.from(vi.mocked(dbUpdateWithFiles).mock.calls[0]![2].keys())).toEqual(["pdfFile"]);
  });

  it("recognizes beat map files", async () => {
    expect(await isBeatMapFile(beatMapFile())).toBe(true);
    expect(await isBeatMapFile(new File(["{}"], "x.json"))).toBe(false);
    expect(await isBeatMapFile(new File(["not json"], "x.json"))).toBe(false);
  });
});
