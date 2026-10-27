import { afterEach, describe, expect, it, vi } from "vitest";

import { dbGetOne, dbUpdate } from "@/pocketbase/db";
import { idOf, locationOf, makeAudioSongWithRepeat, makeMidiSong } from "@/test/fixtures";

import { addMarker } from "./markers";
import { createEmptyMeasureEdit } from "./measure";
import { replaceSections, type Section } from "./sections";
import type Song from "./song";
import SongHistory, { HistoryConflictError, MAX_HISTORY_LENGTH } from "./songHistory";
import { addWarpMarker, moveWarpMarker } from "./warpEditing";

vi.mock("@/pocketbase/db", () => ({
  dbGetOne: vi.fn(async (_collection: string, id: string) => ({ id })),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

const BOX = { page: 0, x: 0.8, y: 0.8, width: 0.1, height: 0.1 };

function track(song: Song): SongHistory {
  return new SongHistory(song);
}

async function rename(song: Song, label: string, next: string): Promise<void> {
  await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), relabels: new Map([[idOf(song, label), next]]) });
}

function labels(song: Song): string[] {
  return song.getMeasures().map(measure => measure.label);
}

describe("SongHistory", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("undoes and redoes changes in order", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await rename(song, "1", "1a");
    await rename(song, "2", "2a");

    await history.undo();
    expect(labels(song)).toEqual(["1a", "2", "3", "4"]);
    await history.undo();
    expect(labels(song)).toEqual(["1", "2", "3", "4"]);
    expect(history.getState()).toEqual({ canUndo: false, canRedo: true });

    await history.redo();
    await history.redo();
    expect(labels(song)).toEqual(["1a", "2a", "3", "4"]);
    expect(history.getState()).toEqual({ canUndo: true, canRedo: false });
  });

  it("writes each undo in one request", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), removals: [idOf(song, "3")] });
    vi.clearAllMocks();

    await history.undo();

    expect(dbUpdate).toHaveBeenCalledTimes(1);
    expect(Object.keys(vi.mocked(dbUpdate).mock.calls[0]![2])).toEqual(["score", "recording", "arrangement"]);
  });

  it("clears the redo entries on a new edit", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await rename(song, "1", "1a");
    await history.undo();

    await rename(song, "2", "2a");

    expect(history.getState()).toEqual({ canUndo: true, canRedo: false });
    await history.redo();
    expect(labels(song)).toEqual(["1", "2a", "3", "4"]);
  });

  it("reports state changes", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    const states: unknown[] = [];
    history.onStateChange(state => states.push(state));

    await rename(song, "1", "1a");
    await history.undo();

    expect(states).toEqual([{ canUndo: true, canRedo: false }, { canUndo: false, canRedo: true }]);
  });

  it("keeps the history when the save fails", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await rename(song, "1", "1a");
    vi.mocked(dbUpdate).mockRejectedValueOnce(new Error("offline"));

    await expect(history.undo()).rejects.toThrow("offline");

    expect(labels(song)).toContain("1a");
    expect(history.getState()).toEqual({ canUndo: true, canRedo: false });
    await history.undo();
    expect(labels(song)).toContain("1");
  });

  it("refuses to undo over a change saved elsewhere and drops the history", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await rename(song, "1", "1a");
    vi.clearAllMocks();
    vi.mocked(dbGetOne).mockResolvedValueOnce({ id: song.id, updated: "someone else" });

    await expect(history.undo()).rejects.toThrow(HistoryConflictError);

    expect(dbUpdate).not.toHaveBeenCalled();
    expect(labels(song)).toContain("1a");
    expect(history.getState()).toEqual({ canUndo: false, canRedo: false });
  });

  it("refuses to undo when the layers changed without the history", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await rename(song, "1", "1a");
    const snapshot = song.getLayerSnapshot();
    await song.restoreLayers({ ...snapshot, arrangement: { ...snapshot.arrangement, segue: true } });

    await expect(history.undo()).rejects.toThrow("changed in another way");
    expect(song.hasSegue()).toBe(true);
    expect(history.getState()).toEqual({ canUndo: false, canRedo: false });
  });

  it("stops recording once disposed", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    await rename(song, "1", "1a");

    history.dispose();
    await rename(song, "2", "2a");

    expect(history.getState()).toEqual({ canUndo: false, canRedo: false });
  });

  it("keeps at most the newest entries", async () => {
    const song = makeAudioSongWithRepeat();
    const history = track(song);
    for (let i = 0; i <= MAX_HISTORY_LENGTH; i++) {
      await song.editLayers({ segue: i % 2 === 0 });
    }

    for (let i = 0; i < MAX_HISTORY_LENGTH; i++) {
      await history.undo();
    }

    expect(history.getState().canUndo).toBe(false);
    expect(song.hasSegue()).toBe(true);
  });

  it("restores the score: boxes, unnumbered boxes and measures", async () => {
    const song = makeAudioSongWithRepeat();
    const before = song.getLayerSnapshot();
    const history = track(song);
    const one = idOf(song, "1");

    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), layouts: new Map([[one, BOX]]), beats: new Map([[one, 3]]), unnumberedBoxes: [BOX] });
    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), additions: [{ label: "5", beats: 4, index: 5 }] });
    await history.undo();
    await history.undo();

    expect(song.getLayerSnapshot()).toEqual(before);
  });

  it("restores the recording: spans and sync points", async () => {
    const song = makeAudioSongWithRepeat();
    const before = song.getLayerSnapshot();
    const history = track(song);

    await song.editLayers({ warpMarkers: addWarpMarker(song.getTimeline(), song.getWarpMarkers(), { measure: idOf(song, "2"), occurrence: 2, time: 0.75 }) });
    await song.editLayers({ warpMarkers: moveWarpMarker(song.getWarpMarkers(), { measure: idOf(song, "3"), occurrence: 1 }, 0.6) });
    await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "4") }]);
    await history.undo();
    await history.undo();
    await history.undo();

    expect(song.getLayerSnapshot()).toEqual(before);
  });

  it("restores the arrangement: markers, sections and the segue", async () => {
    const song = makeAudioSongWithRepeat();
    const before = song.getLayerSnapshot();
    const history = track(song);
    const cut: Section = { kind: "cut", from: locationOf(song, "1"), to: locationOf(song, "1", 3) };

    await song.editLayers({ markers: addMarker(song.getMarkers(), { at: locationOf(song, "4"), text: "A" }) });
    await song.editLayers({ sections: replaceSections(song.getSections(), [...song.getSections()], cut) });
    await song.editLayers({ segue: true });
    await history.undo();
    await history.undo();
    await history.undo();

    expect(song.getLayerSnapshot()).toEqual(before);
  });

  it("restores boxes of a MIDI song", async () => {
    const song = makeMidiSong();
    const before = song.getLayerSnapshot();
    const history = track(song);

    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), layouts: new Map([[idOf(song, "1"), BOX]]) });
    await history.undo();

    expect(song.getLayerSnapshot()).toEqual(before);
  });

  it("does nothing without entries", async () => {
    const song = makeAudioSongWithRepeat();

    await track(song).undo();
    await track(song).redo();

    expect(dbUpdate).not.toHaveBeenCalled();
  });
});
