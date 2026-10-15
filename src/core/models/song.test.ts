import { afterEach, describe, expect, it, vi } from "vitest";

import { dbCreateWithFiles, dbDelete, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";
import { makeMtiJson, TRACK_NAMES } from "@/test/fixtures";

import Measure, { MeasureList } from "./measure";
import Song from "./song";
import Track from "./track";

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbCreateWithFiles: vi.fn(),
  dbDelete: vi.fn(),
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

function entriesOf(call: number): Record<string, FormDataEntryValue> {
  return Object.fromEntries(vi.mocked(dbUpdateWithFiles).mock.calls[call]![2].entries());
}

function beatMapFile(): File {
  return new File([JSON.stringify(makeMtiJson())], "song.json", { type: "application/json" });
}

describe("Song details and files", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves number and title", async () => {
    const song = makeSong();

    await song.updateDetails({ number: "4a", title: "Reprise" });

    expect(dbUpdate).toHaveBeenCalledWith("songs", "song-id", { number: "4a", title: "Reprise" });
    expect([song.number, song.title]).toEqual(["4a", "Reprise"]);
  });

  it("creates measures and MIDI tracks from the beat map of an empty song", async () => {
    const song = makeSong();
    vi.mocked(dbUpdateWithFiles).mockResolvedValueOnce({ id: "song-id", midiFile: "song_1.mid", jsonFile: "song_1.json" });

    await song.addFiles({ midi: new File(["midi"], "song.mid"), beatMap: beatMapFile() });

    const entries = entriesOf(0);
    expect(Object.keys(entries)).toEqual(["midiFile", "jsonFile", "measures", "tracks"]);
    expect(JSON.parse(entries.tracks as string).map((t: { title: string }) => t.title)).toEqual([TRACK_NAMES.instrument, TRACK_NAMES.vocals]);
    expect(song.measures.items().map(m => m.value)).toEqual(["0", "1", "2", "3", "4", "5"]);
    expect([song.midiFile, song.jsonFile, song.playerMode]).toEqual(["song_1.mid", "song_1.json", "midi"]);
  });

  it("keeps existing measures and tracks when a beat map is replaced", async () => {
    const song = new Song("song-id", "1", "Song", undefined, undefined, undefined, [], [new Track("Lead")], new MeasureList([new Measure("1", 3)]));
    vi.mocked(dbUpdateWithFiles).mockResolvedValueOnce({ id: "song-id", midiFile: "a.mid", jsonFile: "a.json" });

    await song.addFiles({ midi: new File(["midi"], "song.mid"), beatMap: beatMapFile() });

    expect(Object.keys(entriesOf(0))).toEqual(["midiFile", "jsonFile"]);
    expect(song.tracks.map(t => t.title)).toEqual(["Lead"]);
  });

  it("uploads recordings and links a named track to each stored file", async () => {
    const song = makeSong();
    mockStoredAudioFiles(["alto_1.mp3", "bass_2.mp3"]);

    await song.addFiles({ recordings: [{ file: mp3("alto.mp3"), title: "Alto" }, { file: mp3("bass.mp3"), title: "Piano" }] });

    expect(song.tracks.map(t => [t.title, t.classification, t.audioFile])).toEqual([
      ["Alto", "Vocal", "alto_1.mp3"],
      ["Piano", "Accompaniment", "bass_2.mp3"],
    ]);
  });

  it("removes the beat map together with the MIDI file", async () => {
    const song = new Song("song-id", "1", "Song", "a.mid", "a.json", undefined, [], [new Track("Lead")]);

    await song.removeMidiFile();

    expect(dbUpdate).toHaveBeenCalledWith("songs", "song-id", { midiFile: null, jsonFile: null, tracks: [] });
    expect([song.midiFile, song.jsonFile, song.playerMode]).toEqual([undefined, undefined, "none"]);
  });

  it("creates a song in its show with empty data", async () => {
    vi.mocked(dbCreateWithFiles).mockResolvedValueOnce({ id: "new-id", number: "2", title: "New", audioFiles: [] });

    const song = await Song.create("show-id", { number: "2", title: "New" });

    const entries = Object.fromEntries(vi.mocked(dbCreateWithFiles).mock.calls[0]![1].entries());
    expect(entries).toMatchObject({ show: "show-id", number: "2", title: "New", tracks: "[]", measures: "[]" });
    expect(JSON.parse(entries.events as string)).toEqual({ markers: [], vamps: [], segue: false });
    expect([song.id, song.number, song.title]).toEqual(["new-id", "2", "New"]);
  });

  it("deletes itself", async () => {
    await makeSong().delete();

    expect(dbDelete).toHaveBeenCalledWith("songs", "song-id");
  });
});

describe("Song measure layouts", () => {
  const layoutA = { page: 0, x: 0.1, y: 0, width: 0.1, height: 0.1 };
  const layoutB = { page: 0, x: 0.5, y: 0, width: 0.1, height: 0.1 };

  function makeMeasureSong(): Song {
    return new Song("song-id", "1", "Song", undefined, undefined, undefined, [], [], new MeasureList([
      new Measure("1", 4, layoutA),
      new Measure("2", 4),
      new Measure("3", 4, layoutB),
    ]));
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("moves a layout to a measure without one", async () => {
    const song = makeMeasureSong();

    await song.reassignMeasureLayout(song.measures.items()[0]!, "2");

    expect(song.measures.items().map(m => m.layout)).toEqual([undefined, layoutA, layoutB]);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
  });

  it("swaps layouts with a measure that already has one", async () => {
    const song = makeMeasureSong();

    await song.reassignMeasureLayout(song.measures.items()[0]!, "3");

    expect(song.measures.items().map(m => m.layout)).toEqual([layoutB, undefined, layoutA]);
  });

  it("ignores unknown measure numbers", async () => {
    const song = makeMeasureSong();

    await song.reassignMeasureLayout(song.measures.items()[0]!, "9");

    expect(song.measures.items()[0]!.layout).toEqual(layoutA);
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});

describe("Song measure detection", () => {
  const layout = { page: 1, x: 0.2, y: 0.3, width: 0.2, height: 0.1 };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("places existing measures and inserts new ones in one save", async () => {
    const song = new Song("song-id", "1", "Song", undefined, undefined, undefined, [], [], new MeasureList([
      new Measure("1", 4),
      new Measure("3", 4),
    ]));

    await song.applyMeasureDetection({
      placements: [{ measure: song.measures.items()[0]!, layout }],
      additions: [new Measure("2", 3, layout)],
      keptPlaced: [],
      duplicates: [],
      unmatched: [],
      lowConfidence: [],
    });

    expect(song.measures.items().map(m => [m.value, m.beats, m.layout])).toEqual([
      ["1", 4, layout],
      ["2", 3, layout],
      ["3", 4, undefined],
    ]);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
  });
});
