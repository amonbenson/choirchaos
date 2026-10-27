import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, type Ref, ref, shallowRef } from "vue";

import { addMarker } from "@/core/models/markers";
import { createEmptyMeasureEdit } from "@/core/models/measure";
import type Song from "@/core/models/song";
import { moveWarpMarker } from "@/core/models/warpEditing";
import { idOf, locationOf, makeAudioSongWithRepeat } from "@/test/fixtures";

import { useMeasureEditor } from "./useMeasureEditor";
import { usePlayerSync } from "./usePlayerSync";

const player = vi.hoisted(() => ({
  position: 1234,
  currentLocation: undefined,
  load: (async () => {}) as (song: unknown) => Promise<void>,
  seek: (() => {}) as (position: number) => void,
  syncWarp: () => {},
}));

vi.mock("@/stores/player", () => ({ usePlayerStore: () => player }));

const notifyError = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useNotify", () => ({ useNotify: () => ({ notifyError, notifySuccess: vi.fn() }) }));

vi.mock("@/pocketbase/db", () => ({
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

function follow(song: Song): { stop: () => void; song: Ref<Song | undefined> } {
  const current = shallowRef<Song | undefined>(song);
  const scope = effectScope();
  scope.run(() => usePlayerSync(current));
  return { stop: () => scope.stop(), song: current };
}

describe("usePlayerSync", () => {
  beforeEach(() => {
    player.load = vi.fn(async () => {});
    player.seek = vi.fn();
    player.syncWarp = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reloads the player at the same time when the timing changed", async () => {
    const song = makeAudioSongWithRepeat();
    follow(song);

    await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "4") }]);
    await flushPromises();

    expect(player.load).toHaveBeenCalledWith(song);
    expect(player.seek).toHaveBeenCalledWith(1234);
    expect(player.syncWarp).not.toHaveBeenCalled();
  });

  it("only re-syncs when sync points, sections, markers or boxes changed", async () => {
    const song = makeAudioSongWithRepeat();
    follow(song);

    await song.editLayers({ warpMarkers: moveWarpMarker(song.getWarpMarkers(), song.getWarpMarkers()[1]!, 0.6) });
    await song.editLayers({ markers: addMarker(song.getMarkers(), { at: locationOf(song, "1"), text: "A" }) });
    await song.applyMeasureEdit({ ...createEmptyMeasureEdit(), relabels: new Map([[idOf(song, "1"), "1a"]]) });

    expect(player.load).not.toHaveBeenCalled();
    expect(player.syncWarp).toHaveBeenCalledTimes(3);
  });

  it("follows undo like any other change", async () => {
    const song = makeAudioSongWithRepeat();
    const before = song.getLayerSnapshot();
    await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "4") }]);
    follow(song);

    await song.restoreLayers(before);
    await flushPromises();

    expect(player.load).toHaveBeenCalledWith(song);
  });

  it("follows only the current song and stops with its scope", async () => {
    const first = makeAudioSongWithRepeat();
    const second = makeAudioSongWithRepeat();
    const { song, stop } = follow(first);
    song.value = second;
    await nextTick();

    await first.editLayers({ segue: true });
    expect(player.syncWarp).not.toHaveBeenCalled();
    await second.editLayers({ segue: true });
    expect(player.syncWarp).toHaveBeenCalledOnce();

    stop();
    await second.editLayers({ segue: false });
    expect(player.syncWarp).toHaveBeenCalledOnce();
  });

  it("reports a failed reload", async () => {
    const song = makeAudioSongWithRepeat();
    follow(song);
    player.load = vi.fn(async () => {
      throw new Error("no audio");
    });

    await song.setRecordingSpans([{ from: idOf(song, "1"), to: idOf(song, "4") }]);
    await flushPromises();

    expect(notifyError).toHaveBeenCalledWith("Could not reload the song", expect.any(Error));
  });

  it("lets a measure edit finish before the audio is loaded", async () => {
    const song = makeAudioSongWithRepeat();
    const current = shallowRef<Song | undefined>(song);
    let finishLoad = (): void => {};
    player.load = vi.fn(() => new Promise<void>((resolve) => {
      finishLoad = resolve;
    }));
    const scope = effectScope();
    const editor = scope.run(() => {
      usePlayerSync(current);
      return useMeasureEditor(current, ref(true));
    })!;
    const edit = { ...createEmptyMeasureEdit(), additions: [{ label: "5", beats: 4, index: 5, layout: { page: 0, x: 0.5, y: 0.5, width: 0.1, height: 0.1 } }] };

    await editor.apply({ edit, boxes: [{ addition: 0 }] });

    expect(player.load).toHaveBeenCalledOnce();
    expect(editor.saving.value).toBe(false);
    expect(editor.selection.value.map(measure => measure.label)).toEqual(["5"]);
    finishLoad();
    scope.stop();
  });
});
