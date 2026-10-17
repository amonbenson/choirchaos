import { describe, expect, it } from "vitest";

import { makeMtiJson } from "@/test/fixtures";

import { type ExistingSong, type ImportRow, parseFilename, planImport, resolveImportRow } from "./songImport";

function file(name: string, content = "x"): File {
  return new File([content], name);
}

function beatMap(name: string): File {
  return file(name, JSON.stringify(makeMtiJson()));
}

function existing(overrides: Partial<ExistingSong> = {}): ExistingSong {
  return { id: "song-id", number: "3", hasScore: false, playback: "none", ...overrides };
}

function row(files: ImportRow["files"]): ImportRow {
  return { key: "#3", number: "3", title: "Prologue", files };
}

describe("parseFilename", () => {
  it.each([
    ["03 Prologue.pdf", { number: "3", title: "Prologue", part: "" }],
    ["3a_Swing_Low.pdf", { number: "3a", title: "Swing Low", part: "" }],
    ["No. 12 - Finale.pdf", { number: "12", title: "Finale", part: "" }],
    ["#4 Morning Song.mid", { number: "4", title: "Morning Song", part: "" }],
    ["03 Prologue - Soprano.mp3", { number: "3", title: "Prologue", part: "Soprano" }],
    ["03 Prologue – Alto 1.mp3", { number: "3", title: "Prologue", part: "Alto 1" }],
    ["Program notes.pdf", { number: "", title: "Program notes", part: "" }],
    ["2024 Season.pdf", { number: "2024", title: "Season", part: "" }],
  ])("parses %s", (name, expected) => {
    expect(parseFilename(name)).toEqual(expected);
  });

  it("does not treat a number inside a word as a song number", () => {
    expect(parseFilename("3rd Movement.pdf").number).toBe("");
  });
});

describe("planImport", () => {
  it("groups files with the same number into one song", async () => {
    const { rows, skipped } = await planImport([
      file("03 Prologue - Soprano.mp3"),
      file("03 Prologue.pdf"),
      file("03 Prologue - Alto.mp3"),
      file("01 Overture.pdf"),
    ]);

    expect(skipped).toEqual([]);
    expect(rows.map(r => [r.number, r.title])).toEqual([["3", "Prologue"], ["1", "Overture"]]);
    expect(rows[0]!.files.score?.name).toBe("03 Prologue.pdf");
    expect(rows[0]!.files.recordings?.map(r => r.title)).toEqual(["Soprano", "Alto"]);
  });

  it("prefers the score name as title over recording names", async () => {
    const { rows } = await planImport([file("05 market day - Full.mp3"), file("05 Market Day.pdf")]);

    expect(rows[0]!.title).toBe("Market Day");
  });

  it("names a recording without a part suffix after the full mix", async () => {
    const { rows } = await planImport([file("02 Opening.mp3")]);

    expect(rows[0]!.files.recordings?.map(r => r.title)).toEqual(["Full Mix"]);
  });

  it("accepts recordings in any common audio format", async () => {
    const names = ["04 River - Soprano.wav", "04 River - Alto.aiff", "04 River - Tenor.FLAC", "04 River - Bass.m4a", "04 River - Piano.ogg"];
    const { rows, skipped } = await planImport(names.map(name => file(name)));

    expect(skipped).toEqual([]);
    expect(rows[0]!.files.recordings?.map(r => r.file.name)).toEqual(names);
  });

  it("skips unsupported files with a reason", async () => {
    const { rows, skipped } = await planImport([file("notes.docx"), file("04 River.json", "{}")]);

    expect(rows).toEqual([]);
    expect(skipped.map(s => [s.file.name, s.reason])).toEqual([
      ["notes.docx", "This file type is not supported."],
      ["04 River.json", "This JSON file is not a beat map."],
    ]);
  });

  it("keeps MIDI and its beat map together", async () => {
    const { rows } = await planImport([file("02 Praise.mid"), beatMap("02 Praise.json")]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.files.midi?.name).toBe("02 Praise.mid");
    expect(rows[0]!.files.beatMap?.name).toBe("02 Praise.json");
  });

  it("skips a second score for the same song", async () => {
    const { rows, skipped } = await planImport([file("01 A.pdf"), file("01 A (piano).pdf")]);

    expect(rows[0]!.files.score?.name).toBe("01 A.pdf");
    expect(skipped.map(s => s.file.name)).toEqual(["01 A (piano).pdf"]);
  });

  it("gives files without a number their own row without a number", async () => {
    const { rows } = await planImport([file("Program notes.pdf")]);

    expect(rows.map(r => [r.number, r.title])).toEqual([["", "Program notes"]]);
  });
});

describe("resolveImportRow", () => {
  it("creates a new song when no song has the number", () => {
    const resolved = resolveImportRow(row({ score: file("a.pdf") }), undefined);

    expect(resolved.action).toBe("create");
    expect(resolved.warnings).toEqual([]);
  });

  it("updates an existing song and notes a replaced score", () => {
    const resolved = resolveImportRow(row({ score: file("a.pdf") }), existing({ hasScore: true }));

    expect(resolved).toMatchObject({ action: "update", existingSongId: "song-id", notes: ["Replaces score"] });
  });

  it("drops MIDI without a beat map", () => {
    const resolved = resolveImportRow(row({ score: file("a.pdf"), midi: file("a.mid") }), undefined);

    expect(resolved.files.midi).toBeUndefined();
    expect(resolved.warnings).toEqual(["MIDI needs its beat map (.json) and is skipped."]);
  });

  it("imports only MIDI when a row has MIDI and recordings", () => {
    const resolved = resolveImportRow(row({
      midi: file("a.mid"),
      beatMap: file("a.json"),
      recordings: [{ file: file("a.mp3"), title: "Full Mix" }],
    }), undefined);

    expect(resolved.files.recordings).toEqual([]);
    expect(resolved.files.midi).toBeDefined();
  });

  it("never mixes recordings into a MIDI song", () => {
    const resolved = resolveImportRow(row({ recordings: [{ file: file("a.mp3"), title: "Alto" }] }), existing({ playback: "midi" }));

    expect(resolved.files.recordings).toEqual([]);
    expect(resolved.warnings).toContain("Song plays MIDI, recordings are skipped.");
    expect(resolved.warnings).toContain("Nothing left to import.");
  });

  it("never replaces the recordings of an audio song with MIDI", () => {
    const resolved = resolveImportRow(row({ midi: file("a.mid"), beatMap: file("a.json") }), existing({ playback: "audio" }));

    expect(resolved.files.midi).toBeUndefined();
    expect(resolved.files.beatMap).toBeUndefined();
  });

  it("adds recordings to an existing audio song", () => {
    const resolved = resolveImportRow(row({ recordings: [{ file: file("a.mp3"), title: "Alto" }] }), existing({ playback: "audio" }));

    expect(resolved.notes).toEqual(["Adds 1 recording"]);
    expect(resolved.files.recordings).toHaveLength(1);
  });

  it("does not modify the planned row", () => {
    const planned = row({ midi: file("a.mid") });

    resolveImportRow(planned, undefined);

    expect(planned.files.midi).toBeDefined();
  });
});
