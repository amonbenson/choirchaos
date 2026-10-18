import { describe, expect, it } from "vitest";

import { makeAudioSongWithVamp, makeMidiSong } from "@/test/fixtures";

import Measure, { MeasureList } from "./measure";
import Song from "./song";
import { getSongSetup, hasUnsyncedAudio } from "./songSetup";

const LAYOUT = { page: 0, x: 0, y: 0, width: 0.1, height: 0.1 };

function makeSong(options: { pdf?: boolean; audio?: boolean; measures?: Measure[] } = {}): Song {
  return new Song(
    "song-id",
    "1",
    "Song",
    undefined,
    undefined,
    options.pdf ? "score.pdf" : undefined,
    options.audio ? ["mix.mp3"] : [],
    [],
    new MeasureList(options.measures ?? []),
  );
}

describe("getSongSetup", () => {
  it("asks for a score first on an empty song", () => {
    const setup = getSongSetup(makeSong());

    expect(setup.steps.map(s => s.id)).toEqual(["score", "playback", "measures"]);
    expect(setup.next).toMatchObject({ id: "score", action: "Add score" });
  });

  it("asks for playback once the score exists", () => {
    expect(getSongSetup(makeSong({ pdf: true })).next).toMatchObject({ id: "playback", action: "Add playback" });
  });

  it("counts placed measures", () => {
    const song = makeSong({ pdf: true, audio: true, measures: [new Measure("1", 4, LAYOUT), new Measure("2", 4), new Measure("3", 4)] });

    expect(getSongSetup(song).next).toMatchObject({ id: "measures", action: "Place measures (1 of 3)" });
  });

  it("asks to add measures when there are none", () => {
    expect(getSongSetup(makeSong({ pdf: true, audio: true })).next?.action).toBe("Add measures");
  });

  it("does not expect the terminal measure of a MIDI song on the score", () => {
    const song = makeMidiSong();
    song.pdfFile = "score.pdf";

    expect(getSongSetup(song).next).toBeUndefined();
    expect(getSongSetup(song).steps.map(s => s.id)).toEqual(["score", "playback", "measures"]);
  });

  it("is not ready while detected measures wait for review", () => {
    const song = makeMidiSong();
    song.pdfFile = "score.pdf";
    const first = song.measures.items()[0]!;
    first._applyLayout({ ...first.layout!, review: true });

    expect(getSongSetup(song).next).toMatchObject({ id: "review", action: "Check measures (1 left)" });
  });

  it("counts unnumbered boxes as open review items", () => {
    const song = new Song("song-id", "1", "Song", undefined, undefined, "score.pdf", ["mix.mp3"], [], new MeasureList([new Measure("1", 4, LAYOUT)]), undefined, [], undefined, {}, [LAYOUT, LAYOUT]);

    expect(getSongSetup(song).steps.map(s => s.id)).toEqual(["score", "playback", "measures", "review", "sync"]);
    expect(getSongSetup(song).next).toMatchObject({ id: "review", action: "Check measures (2 left)" });
  });

  it("asks audio songs to sync once everything else is done", () => {
    const song = makeAudioSongWithVamp();
    song.pdfFile = "score.pdf";
    expect(getSongSetup(song).next).toBeUndefined();

    const unsynced = makeSong({ pdf: true, audio: true, measures: [new Measure("1", 4, LAYOUT)] });
    expect(getSongSetup(unsynced).next).toMatchObject({ id: "sync", action: "Sync audio" });
  });
});

describe("hasUnsyncedAudio", () => {
  it("flags audio songs with placed measures but no sync", () => {
    expect(hasUnsyncedAudio(makeSong({ audio: true, measures: [new Measure("1", 4, LAYOUT)] }))).toBe(true);
  });

  it("ignores audio songs without measures on the score", () => {
    expect(hasUnsyncedAudio(makeSong({ audio: true, measures: [new Measure("1", 4)] }))).toBe(false);
  });

  it("ignores synced audio songs and MIDI songs", () => {
    expect(hasUnsyncedAudio(makeAudioSongWithVamp())).toBe(false);
    expect(hasUnsyncedAudio(makeMidiSong())).toBe(false);
  });
});
