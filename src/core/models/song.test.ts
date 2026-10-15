import { afterEach, describe, expect, it, vi } from "vitest";

import { dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";

import Song from "./song";
import Track from "./track";

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

function makeSong(audioFiles: string[] = [], tracks: Track[] = []): Song {
  return new Song("song-id", "1", "Song", undefined, undefined, undefined, audioFiles, tracks);
}

function mockStoredAudioFiles(audioFiles: string[]): void {
  vi.mocked(dbUpdateWithFiles).mockResolvedValueOnce({ id: "song-id", audioFiles });
}

function uploadedEntries(): [string, FormDataEntryValue][] {
  const formData = vi.mocked(dbUpdateWithFiles).mock.calls[0]![2];
  return Array.from(formData.entries());
}

function mp3(name: string): File {
  return new File(["mp3"], name, { type: "audio/mpeg" });
}

describe("Song audio files", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("appends uploads instead of replacing the existing audio files", async () => {
    const song = makeSong(["old_abc.mp3"], [new Track("Old", "Vocal", 0, "old_abc.mp3")]);
    mockStoredAudioFiles(["old_abc.mp3", "new_def.mp3"]);

    await song.uploadAudioFiles([mp3("new.mp3")]);

    expect(uploadedEntries().map(([key]) => key)).toEqual(["audioFiles+"]);
  });

  it("returns only the stored names of the new files, in upload order", async () => {
    const song = makeSong(["old_abc.mp3"]);
    mockStoredAudioFiles(["old_abc.mp3", "solo_111.mp3", "piano_222.mp3"]);

    const filenames = await song.uploadAudioFiles([mp3("solo.mp3"), mp3("piano.mp3")]);

    expect(filenames).toEqual(["solo_111.mp3", "piano_222.mp3"]);
    expect(song.audioFiles).toEqual(["old_abc.mp3", "solo_111.mp3", "piano_222.mp3"]);
    expect(song.playerMode).toBe("audio");
  });

  it("does not call the backend for an empty upload", async () => {
    const song = makeSong();

    expect(await song.uploadAudioFiles([])).toEqual([]);
    expect(dbUpdateWithFiles).not.toHaveBeenCalled();
  });

  it("rejects a single upload when the backend reports no new file", async () => {
    const song = makeSong(["old_abc.mp3"]);
    mockStoredAudioFiles(["old_abc.mp3"]);

    await expect(song.uploadAudioFile(mp3("new.mp3"))).rejects.toThrow("could not determine uploaded filename");
  });

  it("removing a file removes its tracks and reindexes the rest", async () => {
    const song = makeSong(["a.mp3", "b.mp3"], [
      new Track("A", "Vocal", 0, "a.mp3"),
      new Track("B", "Vocal", 0, "b.mp3"),
    ]);

    await song.removeAudioFile("a.mp3");

    expect(song.audioFiles).toEqual(["b.mp3"]);
    expect(song.tracks.map(t => [t.title, t.mixer.index])).toEqual([["B", 0]]);
    expect(dbUpdate).toHaveBeenCalledWith("songs", "song-id", { "audioFiles-": "a.mp3" });
    expect(dbUpdate).toHaveBeenLastCalledWith("songs", "song-id", { tracks: [expect.objectContaining({ audioFile: "b.mp3" })] });
  });

  it("removing the last file switches the song out of audio mode", async () => {
    const song = makeSong(["a.mp3"], [new Track("A", "Vocal", 0, "a.mp3")]);

    await song.removeAudioFile("a.mp3");

    expect(song.tracks).toEqual([]);
    expect(song.playerMode).toBe("none");
  });
});
