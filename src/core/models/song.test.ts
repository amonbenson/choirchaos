import { afterEach, describe, expect, it, vi } from "vitest";

import { dbCreateWithFiles, dbDelete, dbUpdate, dbUpdateWithFiles } from "@/pocketbase/db";
import { idOf, locationOf, makeAudioSongWithRepeat, makeMidiSong, makeMtiJson, TRACK_NAMES } from "@/test/fixtures";

import { scoreFromBeatMap } from "../midi/beatMap";
import Measure, { createEmptyMeasureEdit, type MeasureEdit } from "./measure";
import { findDuplicateRuns } from "./measureReview";
import { findPosition, formatRecording, setRecordedCount, type StoredRecording, validateLocation } from "./recording";
import { type Section, validateSections } from "./sections";
import Song, { type SongLayers, type StoredArrangement, type StoredScore } from "./song";
import Track from "./track";

vi.mock("@/pocketbase/db", () => ({
  dbCreate: vi.fn(),
  dbCreateWithFiles: vi.fn(),
  dbDelete: vi.fn(),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
  dbUpdateWithFiles: vi.fn(),
}));

function makeSong(audioFiles: string[] = [], tracks: Track[] = [], layers: SongLayers = {}): Song {
  return new Song("song-id", "1", "Song", undefined, undefined, undefined, audioFiles, tracks, layers);
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

function lastSave(): Record<string, any> {
  return vi.mocked(dbUpdate).mock.calls.at(-1)![2];
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

const BOX = { page: 0, x: 0.2, y: 0.3, width: 0.2, height: 0.1 };

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

  it("builds score, recording and MIDI tracks from the beat map of an empty song", async () => {
    const song = makeSong();
    vi.mocked(dbUpdateWithFiles).mockResolvedValueOnce({ id: "song-id", midiFile: "song_1.mid", jsonFile: "song_1.json" });

    await song.addFiles({ midi: new File(["midi"], "song.mid"), beatMap: beatMapFile() });

    const built = scoreFromBeatMap(makeMtiJson());
    const entries = entriesOf(0);
    expect(Object.keys(entries)).toEqual(["midiFile", "jsonFile", "score", "recording", "tracks"]);
    expect(JSON.parse(entries.score as string)).toEqual({ measures: built.measures.map(m => m.serialize()), unnumberedBoxes: [] });
    expect(JSON.parse(entries.recording as string)).toEqual({ spans: built.recording, warpMarkers: [] });
    expect(JSON.parse(entries.tracks as string).map((t: { title: string }) => t.title)).toEqual([TRACK_NAMES.instrument, TRACK_NAMES.vocals]);
    expect(song.getMeasures().map(m => m.label)).toEqual(built.measures.map(m => m.label));
    expect([song.midiFile, song.jsonFile, song.playerMode]).toEqual(["song_1.mid", "song_1.json", "midi"]);
  });

  it("keeps the IDs, boxes and references of measures whose label stays when the beat map is replaced", async () => {
    const kept = new Measure("m7", "2", 3, BOX);
    const gone = new Measure("m8", "Coda", 4, { ...BOX, page: 1 });
    const song = makeSong(["a.mp3"], [new Track("Lead")], {
      measures: [kept, gone],
      spans: [{ from: "m7", to: "m8" }],
      warpMarkers: [{ measure: "m7", occurrence: 1, time: 0 }],
      markers: [{ at: { measure: "m7", beat: 0, occurrence: 1 }, text: "A" }, { at: { measure: "m8", beat: 0, occurrence: 1 }, text: "B" }],
    });
    vi.mocked(dbUpdateWithFiles).mockResolvedValueOnce({ id: "song-id", midiFile: "a.mid", jsonFile: "a.json" });

    await song.addFiles({ midi: new File(["midi"], "song.mid"), beatMap: beatMapFile() });

    expect(Object.keys(entriesOf(0))).toEqual(["midiFile", "jsonFile", "score", "recording", "arrangement"]);
    expect(song.findMeasureByLabel("2")).toMatchObject({ id: "m7", layout: BOX });
    expect(song.findMeasure("m8")).toBeUndefined();
    expect(song.getMeasures().filter(m => m.id !== "m7").every(m => /^m(9|\d\d)$/.test(m.id))).toBe(true);
    expect(song.getUnnumberedBoxes()).toEqual([{ ...BOX, page: 1 }]);
    expect(song.getWarpMarkers()).toEqual([]);
    expect(song.getMarkers().map(m => m.text)).toEqual(["A"]);
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

  it("creates a song in its show with empty layers", async () => {
    vi.mocked(dbCreateWithFiles).mockResolvedValueOnce({ id: "new-id", number: "2", title: "New", audioFiles: [] });

    const song = await Song.create("show-id", { number: "2", title: "New" });

    const entries = Object.fromEntries(vi.mocked(dbCreateWithFiles).mock.calls[0]![1].entries());
    expect(Object.keys(entries)).toEqual(["show", "number", "title", "tracks", "score", "recording", "arrangement"]);
    expect(entries).toMatchObject({ show: "show-id", number: "2", title: "New", tracks: "[]" });
    expect(JSON.parse(entries.score as string)).toEqual({ measures: [], unnumberedBoxes: [] });
    expect(JSON.parse(entries.recording as string)).toEqual({ spans: [], warpMarkers: [] });
    expect(JSON.parse(entries.arrangement as string)).toEqual({ markers: [], sections: [], segue: false });
    expect([song.id, song.number, song.title]).toEqual(["new-id", "2", "New"]);
    expect([song.getMeasures(), song.getUnnumberedBoxes(), song.getTimeline()]).toEqual([[], [], []]);
  });

  it("deletes itself", async () => {
    await makeSong().delete();

    expect(dbDelete).toHaveBeenCalledWith("songs", "song-id");
  });
});

describe("Song layers", () => {
  const score: StoredScore = {
    measures: [
      { id: "m1", label: "1", beats: 4, layout: { ...BOX, review: true } },
      { id: "m2", label: "2", beats: 3 },
    ],
    unnumberedBoxes: [BOX],
  };
  const recording: StoredRecording = {
    spans: [{ from: "m1", to: "m2" }, { from: "m2", to: "m2" }],
    warpMarkers: [{ measure: "m1", occurrence: 1, time: 0 }, { measure: "m2", occurrence: 2, time: 4 }],
  };
  const arrangement: StoredArrangement = {
    markers: [{ at: { measure: "m2", beat: 1, occurrence: 2 }, text: "B" }],
    sections: [{ kind: "vamp", from: { measure: "m2", beat: 0 }, to: { measure: "m2", beat: 2 }, passes: 0, out: "anyBar", vocals: "last" }],
    segue: true,
  };
  const record = { id: "song-id", number: "1", title: "Song", audioFiles: ["a.mp3"], tracks: [], score, recording, arrangement };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("round-trips the three layers in exactly their stored shapes", () => {
    const serialized = Song.deserialize(record).serialize();

    expect(serialized.score).toEqual(score);
    expect(serialized.recording).toEqual(recording);
    expect(serialized.arrangement).toEqual(arrangement);
    expect(Object.keys(serialized.score.measures[1])).toEqual(["id", "label", "beats"]);
  });

  it("exposes the layers", () => {
    const song = Song.deserialize(record);

    expect(song.getMeasures().map(m => m.label)).toEqual(["1", "2"]);
    expect(song.findMeasure("m2")?.label).toBe("2");
    expect(song.findMeasureByLabel("1")?.id).toBe("m1");
    expect([song.getScoreIndex("m2"), song.getScoreIndex("m9")]).toEqual([1, -1]);
    expect(song.getRecording()).toEqual(recording.spans);
    expect(song.getWarpMarkers()).toEqual(recording.warpMarkers);
    expect(song.getMarkers()).toEqual([{ at: { measure: "m2", beat: 1, occurrence: 2 }, text: "B" }]);
    expect(song.getSections()[0]).toMatchObject({ kind: "vamp", from: { occurrence: 1 }, out: "anyBar" });
    expect(song.hasSegue()).toBe(true);
    expect(song.getUnnumberedBoxes()).toEqual([BOX]);
  });

  it("orders stored markers and sections in timeline order", () => {
    const song = Song.deserialize({
      ...record,
      arrangement: {
        markers: [{ at: { measure: "m2", beat: 0, occurrence: 2 }, text: "Late" }, { at: { measure: "m1", beat: 0 }, text: "Early" }],
        sections: [
          { kind: "repeat", from: { measure: "m2", beat: 0, occurrence: 2 }, to: { measure: "m2", beat: 2, occurrence: 2 }, passes: 2 },
          { kind: "cut", from: { measure: "m1", beat: 0 }, to: { measure: "m1", beat: 3 } },
        ],
        segue: false,
      },
    });

    expect(song.getMarkers().map(marker => marker.text)).toEqual(["Early", "Late"]);
    expect(song.getSections().map(section => section.kind)).toEqual(["cut", "repeat"]);
  });

  it("caches the timeline until the measures or the recording change", async () => {
    const song = Song.deserialize(record);
    const timeline = song.getTimeline();

    expect(timeline.map(e => [e.measure, e.occurrence])).toEqual([["m1", 1], ["m2", 1], ["m2", 2]]);
    expect(song.getTimeline()).toBe(timeline);

    await song.setRecordingSpans([{ from: "m1", to: "m2" }]);

    expect(song.getTimeline()).not.toBe(timeline);
    expect(song.getTimeline()).toHaveLength(2);
  });
});

describe("Song measure edits", () => {
  const layoutA = { page: 0, x: 0.1, y: 0, width: 0.1, height: 0.1 };
  const layoutB = { page: 0, x: 0.5, y: 0, width: 0.1, height: 0.1 };

  // Measures "1" to "3", the recording plays 1 2 3 2 3.
  function makeAudioMeasureSong(): Song {
    return makeSong(["a.mp3"], [], {
      measures: [new Measure("m1", "1", 4, layoutA), new Measure("m2", "2", 4), new Measure("m3", "3", 4, layoutB)],
      spans: [{ from: "m1", to: "m3" }, { from: "m2", to: "m3" }],
      warpMarkers: [{ measure: "m1", occurrence: 1, time: 0 }, { measure: "m3", occurrence: 2, time: 4 }],
      markers: [{ at: { measure: "m3", beat: 0, occurrence: 1 }, text: "B" }, { at: { measure: "m1", beat: 3, occurrence: 1 }, text: "A" }],
      sections: [{ kind: "repeat", from: { measure: "m2", beat: 0, occurrence: 1 }, to: { measure: "m3", beat: 3, occurrence: 1 }, passes: 1 }],
    });
  }

  function edit(changes: Partial<MeasureEdit>): MeasureEdit {
    return { ...createEmptyMeasureEdit(), ...changes };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("saves layouts and labels as the score only", async () => {
    const song = makeAudioMeasureSong();

    await song.applyMeasureEdit(edit({ layouts: new Map([["m1", undefined], ["m2", layoutA]]), relabels: new Map([["m3", "3a"]]) }));

    expect(song.getMeasures().map(m => [m.id, m.label, m.layout])).toEqual([["m1", "1", undefined], ["m2", "2", layoutA], ["m3", "3a", layoutB]]);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(lastSave()).toEqual({ score: song.serialize().score });
  });

  it("keeps references on relabeled measures, since they use IDs", async () => {
    const song = makeAudioMeasureSong();

    await song.applyMeasureEdit(edit({ relabels: new Map([["m3", "0"]]) }));

    expect(song.getMeasures().map(m => m.label)).toEqual(["1", "2", "0"]);
    expect(song.getMarkers()).toHaveLength(2);
    expect(song.getWarpMarkers()).toHaveLength(2);
  });

  it("removes references and recording entries of removed measures in one save", async () => {
    const song = makeAudioMeasureSong();

    await song.applyMeasureEdit(edit({ removals: ["m3"] }));

    expect(song.getMeasures().map(m => m.id)).toEqual(["m1", "m2"]);
    expect(song.getRecording()).toEqual([{ from: "m1", to: "m2" }, { from: "m2", to: "m2" }]);
    expect(song.getWarpMarkers().map(m => m.measure)).toEqual(["m1"]);
    expect(song.getMarkers().map(m => m.text)).toEqual(["A"]);
    expect(song.getSections()).toEqual([]);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(lastSave())).toEqual(["score", "recording", "arrangement"]);
  });

  it("drops spans that only held a removed measure", async () => {
    const song = makeSong([], [], {
      measures: [new Measure("m1", "1", 4), new Measure("m2", "2", 4)],
      spans: [{ from: "m1", to: "m2" }, { from: "m2", to: "m2" }],
    });

    await song.applyMeasureEdit(edit({ removals: ["m2"] }));

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m1" }]);
    expect(Object.keys(lastSave())).toEqual(["score", "recording"]);
  });

  it("adds measures with fresh IDs at their score index and plays them inside a span", async () => {
    const song = makeAudioMeasureSong();

    const added = await song.applyMeasureEdit(edit({ additions: [{ label: "2a", beats: 3, layout: layoutB, index: 2 }] }));

    expect(added.map(m => [m.id, m.label, m.beats])).toEqual([["m4", "2a", 3]]);
    expect(song.getMeasures().map(m => m.label)).toEqual(["1", "2", "2a", "3"]);
    expect(song.getTimeline().map(e => e.measure)).toEqual(["m1", "m2", "m4", "m3", "m2", "m4", "m3"]);
    expect(Object.keys(lastSave())).toEqual(["score"]);
  });

  it("extends the last span ending right before measures added after it", async () => {
    const song = makeAudioMeasureSong();

    const added = await song.applyMeasureEdit(edit({
      additions: [{ label: "5", beats: 4, index: 4 }, { label: "4", beats: 4, index: 3 }],
    }));

    expect(added.map(m => [m.id, m.label])).toEqual([["m4", "5"], ["m5", "4"]]);
    expect(song.getMeasures().map(m => m.label)).toEqual(["1", "2", "3", "4", "5"]);
    expect(song.getRecording()).toEqual([{ from: "m1", to: "m3" }, { from: "m2", to: "m4" }]);
    expect(lastSave().recording).toEqual(song.serialize().recording);
  });

  it("gives the first measure of an empty song its own span", async () => {
    const song = makeSong(["a.mp3"]);

    await song.applyMeasureEdit(edit({ additions: [{ label: "1", beats: 4, index: 0 }, { label: "2", beats: 4, index: 1 }] }));

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m2" }]);
  });

  it("drops references to beats that no longer exist", async () => {
    const song = makeAudioMeasureSong();

    await song.applyMeasureEdit(edit({ beats: new Map([["m1", 3]]) }));

    expect(song.findMeasure("m1")?.beats).toBe(3);
    expect(song.getMarkers().map(m => m.text)).toEqual(["B"]);
    expect(Object.keys(lastSave())).toEqual(["score", "arrangement"]);
  });

  it("replaces the unnumbered boxes", async () => {
    const song = makeSong([], [], { unnumberedBoxes: [layoutA, layoutB] });

    await song.applyMeasureEdit(edit({ unnumberedBoxes: [layoutB] }));

    expect(song.getUnnumberedBoxes()).toEqual([layoutB]);
    expect(lastSave()).toEqual({ score: { measures: [], unnumberedBoxes: [layoutB] } });
  });

  it("does not save an empty edit", async () => {
    await makeAudioMeasureSong().applyMeasureEdit(createEmptyMeasureEdit());

    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("rejects invalid edits without changing anything", async () => {
    const song = makeAudioMeasureSong();
    const before = song.serialize();

    await expect(song.applyMeasureEdit(edit({ relabels: new Map([["m1", "2"]]) }))).rejects.toThrow("exists twice");
    await expect(song.applyMeasureEdit(edit({ additions: [{ label: " ", beats: 4, index: 0 }] }))).rejects.toThrow("must not be empty");
    await expect(song.applyMeasureEdit(edit({ removals: ["m9"] }))).rejects.toThrow("does not exist");
    await expect(song.applyMeasureEdit(edit({ beats: new Map([["m1", 0]]) }))).rejects.toThrow("positive");

    expect(song.serialize()).toEqual(before);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("allows swapping labels in one edit", async () => {
    const song = makeAudioMeasureSong();

    await song.applyMeasureEdit(edit({ relabels: new Map([["m1", "2"], ["m2", "1"]]) }));

    expect(song.getMeasures().map(m => m.label)).toEqual(["2", "1", "3"]);
  });

  it("only attaches layouts and labels in MIDI songs", async () => {
    const song = makeMidiSong();

    await expect(song.applyMeasureEdit(edit({ additions: [{ label: "9", beats: 4, index: 0 }] }))).rejects.toThrow("beat map");
    await expect(song.applyMeasureEdit(edit({ removals: [idOf(song, "1")] }))).rejects.toThrow("beat map");

    await song.applyMeasureEdit(edit({ relabels: new Map([[idOf(song, "1"), "1R"]]) }));
    expect(song.findMeasureByLabel("1R")).toBeDefined();
  });
});

describe("Song recording", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("adds warp markers in timeline order", async () => {
    const song = makeAudioSongWithRepeat();
    const two = idOf(song, "2");

    await song.addWarpMarker({ measure: two, occurrence: 3, time: 1.25 });
    await song.addWarpMarker({ measure: two, occurrence: 2, time: 0.75 });

    expect(song.getWarpMarkers().map(m => [m.measure, m.occurrence])).toEqual([
      [idOf(song, "1"), 1],
      [idOf(song, "3"), 1],
      [two, 2],
      [two, 3],
    ]);
    expect(lastSave()).toEqual({ recording: song.serialize().recording });
  });

  it("rejects warp markers that do not resolve or already exist", async () => {
    const song = makeAudioSongWithRepeat();

    await expect(song.addWarpMarker({ measure: idOf(song, "2"), occurrence: 4, time: 1 })).rejects.toThrow("not played 4 times");
    await expect(song.addWarpMarker({ measure: idOf(song, "1"), occurrence: 1, time: 1 })).rejects.toThrow("already has");
    await expect(makeMidiSong().addWarpMarker({ measure: "m1", occurrence: 1, time: 1 })).rejects.toThrow("beat map");
  });

  it("moves and removes warp markers by occurrence", async () => {
    const song = makeAudioSongWithRepeat();
    const three = { measure: idOf(song, "3"), occurrence: 1 };

    await song.moveWarpMarker(three, 0.6);
    expect(song.getWarpMarkers()[1]).toEqual({ ...three, time: 0.6 });

    await song.removeWarpMarker(three);
    expect(song.getWarpMarkers()).toHaveLength(1);
    expect(lastSave()).toEqual({ recording: song.serialize().recording });
  });

  it("replaces the spans and drops what no longer resolves", async () => {
    const song = makeAudioSongWithRepeat();
    await song.addMarker(locationOf(song, "3", 0, 3), "Last time");
    vi.clearAllMocks();

    await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "4") }]);

    expect(song.getTimeline()).toHaveLength(4);
    expect(song.getMarkers()).toEqual([]);
    expect(song.getSections()).toHaveLength(1);
    expect(Object.keys(lastSave())).toEqual(["recording", "arrangement"]);
  });

  it("rejects spans that do not follow the score", async () => {
    const song = makeAudioSongWithRepeat();

    await expect(song.setRecordingSpans([{ from: idOf(song, "3"), to: idOf(song, "1") }])).rejects.toThrow(RangeError);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  // Measures "1" to "4", the recording plays 1 2 3 4 2 3 4. The change below leaves out the first 3.
  function makeDalSegnoSong(): Song {
    return makeSong(["a.mp3"], [], {
      measures: [new Measure("m1", "1", 4), new Measure("m2", "2", 4), new Measure("m3", "3", 4), new Measure("m4", "4", 4)],
      spans: [{ from: "m1", to: "m4" }, { from: "m2", to: "m4" }],
      warpMarkers: [
        { measure: "m1", occurrence: 1, time: 0 },
        { measure: "m3", occurrence: 1, time: 1 },
        { measure: "m2", occurrence: 2, time: 2 },
        { measure: "m4", occurrence: 2, time: 3 },
      ],
      markers: [{ at: { measure: "m3", beat: 0, occurrence: 1 }, text: "A" }, { at: { measure: "m3", beat: 1, occurrence: 2 }, text: "B" }],
      sections: [{ kind: "repeat", from: { measure: "m2", beat: 0, occurrence: 2 }, to: { measure: "m3", beat: 3, occurrence: 2 }, passes: 2 }],
    });
  }

  const WITHOUT_FIRST_THREE = [{ from: "m1", to: "m2" }, { from: "m4", to: "m4" }, { from: "m2", to: "m4" }];

  it("moves warp markers, markers and sections with their timeline position and keeps warp marker times", async () => {
    const song = makeDalSegnoSong();

    await song.setRecordingSpans(WITHOUT_FIRST_THREE);

    expect(song.getTimeline().map(e => e.measure)).toEqual(["m1", "m2", "m4", "m2", "m3", "m4"]);
    expect(song.getWarpMarkers()).toEqual([
      { measure: "m1", occurrence: 1, time: 0 },
      { measure: "m2", occurrence: 2, time: 2 },
      { measure: "m4", occurrence: 2, time: 3 },
    ]);
    expect(song.getMarkers()).toEqual([{ at: { measure: "m3", beat: 1, occurrence: 1 }, text: "B" }]);
    expect(song.getSections()).toEqual([{ kind: "repeat", from: { measure: "m2", beat: 0, occurrence: 2 }, to: { measure: "m3", beat: 3, occurrence: 1 }, passes: 2 }]);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(lastSave()).toEqual({ recording: song.serialize().recording, arrangement: song.serialize().arrangement });
  });

  it("previews the length and the dropped references without changing anything", () => {
    const song = makeDalSegnoSong();
    const before = song.serialize();

    const preview = song.previewRecordingSpans(WITHOUT_FIRST_THREE);

    expect(preview.spans).toEqual(WITHOUT_FIRST_THREE);
    expect(preview.length).toBe(6);
    expect(preview.dropped).toEqual({ warpMarkers: [{ measure: "m3", occurrence: 1, time: 1 }], markers: [song.getMarkers()[0]], sections: [] });
    expect(song.serialize()).toEqual(before);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("saves only the recording when the arrangement keeps its locations", async () => {
    const song = makeAudioSongWithRepeat();

    await song.setRecordingSpans(setRecordedCount(song.getMeasures(), song.getRecording(), { from: locationOf(song, "2"), to: locationOf(song, "3") }, 4));

    expect(song.getTimeline()).toHaveLength(10);
    expect(song.getSections()[0]).toMatchObject({ from: locationOf(song, "2"), to: locationOf(song, "3", 3) });
    expect(Object.keys(lastSave())).toEqual(["recording"]);
  });

  it("drops sections that end up inside the recorded passes of another", () => {
    const song = makeSong(["a.mp3"], [], {
      measures: [new Measure("m1", "1", 4), new Measure("m2", "2", 4), new Measure("m3", "3", 4)],
      spans: [{ from: "m1", to: "m2" }, { from: "m1", to: "m1" }, { from: "m3", to: "m3" }],
      sections: [
        { kind: "repeat", from: { measure: "m1", beat: 0, occurrence: 1 }, to: { measure: "m1", beat: 3, occurrence: 1 }, passes: 2 },
        { kind: "cut", from: { measure: "m1", beat: 0, occurrence: 2 }, to: { measure: "m1", beat: 3, occurrence: 2 } },
      ],
    });

    const preview = song.previewRecordingSpans([{ from: "m1", to: "m1" }, { from: "m1", to: "m3" }]);

    expect(preview.dropped.sections).toEqual([song.getSections()[1]]);
  });

  it("keeps MIDI recordings read-only", async () => {
    const song = makeMidiSong();

    expect(song.isRecordingEditable()).toBe(false);
    expect(makeAudioSongWithRepeat().isRecordingEditable()).toBe(true);
    await expect(song.setRecordingSpans([{ from: idOf(song, "0"), to: idOf(song, "1") }])).rejects.toThrow("beat map");
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});

function numbers(from: number, to: number): string[] {
  return Array.from({ length: to - from + 1 }, (_, i) => String(from + i));
}

/**
 * Measures with the IDs "m1", "m2", ... played straight through, like the songs of the Durchs-Loch guide
 * after the migration. A measure named in `copies` gets the box of the measure it fakes a repeat of.
 */
function makeFakedRepeatSong(labels: string[], copies: Record<string, string>, layers: SongLayers = {}): Song {
  const measures = labels.map((label, i) => new Measure(`m${i + 1}`, label, 4, { page: Math.floor(i / 20), x: (i % 20) / 20, y: 0.1, width: 0.05, height: 0.1 }));
  for (const measure of measures) {
    const original = copies[measure.label];
    if (original) {
      measure.layout = measures.find(other => other.label === original)!.layout;
    }
  }

  return makeSong(["a.mp3"], [], { measures, spans: [{ from: "m1", to: `m${labels.length}` }], ...layers });
}

function expectValidLayers(song: Song): void {
  const timeline = song.getTimeline();
  const times = song.getWarpMarkers().map(marker => marker.time);

  expect(song.getWarpMarkers().every(marker => findPosition(timeline, marker) !== undefined)).toBe(true);
  expect(times.every((time, i) => i === 0 || time > times[i - 1]!)).toBe(true);
  expect(song.getMarkers().every(marker => !validateLocation(song.getMeasures(), timeline, marker.at))).toBe(true);
  expect(validateSections(song.getMeasures(), timeline, song.getSections())).toEqual([]);
}

async function playDetectedDuplicatesAsRepeat(song: Song): Promise<void> {
  const [run] = findDuplicateRuns(song.getMeasures());
  await song.playDuplicatesAsRepeat(run!.duplicates.map(m => m.id), run!.originals.map(m => m.id));
}

describe("Song duplicates played as a repeat", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("turns 8a to 8h of Durchs Loch und mittendrin into the second time of 1 to 8", async () => {
    const labels = [...numbers(1, 8), ..."abcdefgh".split("").map(letter => `8${letter}`), ...numbers(9, 106)];
    const copies = Object.fromEntries("abcdefgh".split("").map((letter, i) => [`8${letter}`, String(i + 1)]));
    const warpMarkers = [{ measure: "m1", occurrence: 1, time: 0.3315 }, { measure: "m114", occurrence: 1, time: 210.558 }];
    const song = makeFakedRepeatSong(labels, copies, { warpMarkers });
    const box = song.findMeasure("m1")!.layout;

    expect(findDuplicateRuns(song.getMeasures()).map(run => [run.duplicates.map(m => m.label), run.originals.map(m => m.label)])).toEqual([
      [["8a", "8b", "8c", "8d", "8e", "8f", "8g", "8h"], numbers(1, 8)],
    ]);

    await playDetectedDuplicatesAsRepeat(song);

    expect(song.getMeasures()).toHaveLength(106);
    expect(song.findMeasure("m9")).toBeUndefined();
    expect(song.findMeasure("m1")!.layout).toBe(box);
    expect(song.getRecording()).toEqual([{ from: "m1", to: "m8" }, { from: "m1", to: "m8" }, { from: "m17", to: "m114" }]);
    expect(song.getTimeline()).toHaveLength(114);
    expect(song.getWarpMarkers()).toEqual(warpMarkers);
    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(lastSave()).toEqual({ score: song.serialize().score, recording: song.serialize().recording });
    expectValidLayers(song);
  });

  it("turns 4a to 4d of Ohne Sorgen chill'n into the second time of 1 to 4", async () => {
    const labels = [...numbers(1, 4), "4a", "4b", "4c", "4d", ...numbers(5, 122)];
    const song = makeFakedRepeatSong(labels, { "4a": "1", "4b": "2", "4c": "3", "4d": "4" });

    await playDetectedDuplicatesAsRepeat(song);

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m4" }, { from: "m1", to: "m4" }, { from: "m9", to: "m126" }]);
    expectValidLayers(song);
  });

  it("moves the warp marker and the vamp on 22 to 25 of It's A Privilege To Pee (Reprise) to the second time of 21A to 21D", async () => {
    const labels = [...numbers(1, 21), "21A", "21B", "21C", "21D", ...numbers(22, 30)];
    const song = makeFakedRepeatSong(labels, { 22: "21A", 23: "21B", 24: "21C", 25: "21D" }, {
      warpMarkers: [{ measure: "m1", occurrence: 1, time: 0 }, { measure: "m26", occurrence: 1, time: 32.62 }, { measure: "m34", occurrence: 1, time: 60 }],
      markers: [{ at: { measure: "m27", beat: 2, occurrence: 1 }, text: "Breath" }],
      sections: [{ kind: "vamp", from: { measure: "m26", beat: 0, occurrence: 1 }, to: { measure: "m29", beat: 1, occurrence: 1 }, passes: 0, out: "onEnd", vocals: "all" }],
    });
    const run = findDuplicateRuns(song.getMeasures())[0]!;

    const preview = song.previewDuplicatesAsRepeat(run.duplicates.map(m => m.id), run.originals.map(m => m.id));
    expect(formatRecording(preview.spans, song.getMeasures())).toBe("1-21D, 21A-21D, 26-30");
    expect(preview.length).toBe(34);
    expect(preview.dropped).toEqual({ warpMarkers: [], markers: [], sections: [] });

    await playDetectedDuplicatesAsRepeat(song);

    expect(song.getRecording()).toEqual([{ from: "m1", to: "m25" }, { from: "m22", to: "m25" }, { from: "m30", to: "m34" }]);
    expect(song.getWarpMarkers()).toEqual([
      { measure: "m1", occurrence: 1, time: 0 },
      { measure: "m22", occurrence: 2, time: 32.62 },
      { measure: "m34", occurrence: 1, time: 60 },
    ]);
    expect(song.getMarkers()).toEqual([{ at: { measure: "m23", beat: 2, occurrence: 2 }, text: "Breath" }]);
    expect(song.getSections()).toEqual([{
      kind: "vamp",
      from: { measure: "m22", beat: 0, occurrence: 2 },
      to: { measure: "m25", beat: 1, occurrence: 2 },
      passes: 0,
      out: "onEnd",
      vocals: "all",
    }]);
    expect(Object.keys(lastSave())).toEqual(["score", "recording", "arrangement"]);
    expectValidLayers(song);
  });

  it("rejects duplicates that do not pair up with originals", async () => {
    const song = makeFakedRepeatSong(numbers(1, 4), { 3: "1" });

    expect(() => song.previewDuplicatesAsRepeat(["m3", "m4"], ["m1"])).toThrow("exactly one original");
    expect(() => song.previewDuplicatesAsRepeat(["m9"], ["m1"])).toThrow("does not exist");
    expect(() => song.previewDuplicatesAsRepeat(["m3", "m1"], ["m1", "m2"])).toThrow("both");
    await expect(makeMidiSong().playDuplicatesAsRepeat(["m2"], ["m1"])).rejects.toThrow("beat map");
    expect(dbUpdate).not.toHaveBeenCalled();
  });
});

describe("Song arrangement", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function savedArrangement(): StoredArrangement {
    return lastSave().arrangement;
  }

  it("adds markers in timeline order", async () => {
    const song = makeAudioSongWithRepeat();
    await song.addMarker(locationOf(song, "2", 0, 2), "B");
    await song.addMarker(locationOf(song, "3"), "A");

    expect(song.getMarkers().map(m => m.text)).toEqual(["A", "B"]);
    expect(savedArrangement().markers).toEqual([
      { at: { measure: idOf(song, "3"), beat: 0 }, text: "A" },
      { at: { measure: idOf(song, "2"), beat: 0, occurrence: 2 }, text: "B" },
    ]);
  });

  it("rejects markers that do not resolve", async () => {
    const song = makeAudioSongWithRepeat();

    await expect(song.addMarker(locationOf(song, "1", 0, 2), "A")).rejects.toThrow("not played 2 times");
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("keeps the order when a marker moves", async () => {
    const song = makeAudioSongWithRepeat();
    const first = await song.addMarker(locationOf(song, "1"), "A");
    await song.addMarker(locationOf(song, "3"), "B");

    await song.updateMarker(first, locationOf(song, "4"), "C");

    expect(song.getMarkers().map(m => m.text)).toEqual(["B", "C"]);
  });

  it("removes only the given marker when two share a location", async () => {
    const song = makeAudioSongWithRepeat();
    await song.addMarker(locationOf(song, "3"), "A");
    const second = await song.addMarker(locationOf(song, "3"), "B");

    await song.removeMarker(second);

    expect(song.getMarkers().map(m => m.text)).toEqual(["A"]);
  });

  it("adds, updates and removes sections in timeline order", async () => {
    const song = makeAudioSongWithRepeat();
    const cut: Section = { kind: "cut", from: locationOf(song, "1"), to: locationOf(song, "1", 3) };

    await song.addSection(cut);
    expect(song.getSections().map(s => s.kind)).toEqual(["cut", "repeat"]);
    expect(savedArrangement().sections[0]).toEqual({ kind: "cut", from: { measure: idOf(song, "1"), beat: 0 }, to: { measure: idOf(song, "1"), beat: 3 } });

    await song.updateSection(1, { ...song.getSections()[1]!, passes: 2 } as Section);
    expect(song.getSections()[1]).toMatchObject({ kind: "repeat", passes: 2 });

    await song.removeSection(0);
    expect(song.getSections().map(s => s.kind)).toEqual(["repeat"]);
  });

  it("rejects overlapping or invalid sections", async () => {
    const song = makeAudioSongWithRepeat();

    await expect(song.addSection({ kind: "cut", from: locationOf(song, "3", 0, 3), to: locationOf(song, "4", 3) })).rejects.toThrow("overlap");
    await expect(song.addSection({ kind: "repeat", from: locationOf(song, "4"), to: locationOf(song, "4", 3), passes: 0 })).rejects.toThrow("at least 1");
    expect(song.getSections()).toHaveLength(1);
    expect(dbUpdate).not.toHaveBeenCalled();
  });

  it("toggles the segue", async () => {
    const song = makeSong();

    await song.setSegue(true);

    expect(song.hasSegue()).toBe(true);
    expect(lastSave()).toEqual({ arrangement: { markers: [], sections: [], segue: true } });
  });
});
