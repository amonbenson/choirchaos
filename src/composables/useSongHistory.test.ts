import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, type Ref, ref, shallowRef } from "vue";

import type Song from "@/core/models/song";
import { dbGetOne } from "@/pocketbase/db";
import { makeAudioSongWithRepeat } from "@/test/fixtures";

import { type SongHistoryControls, useSongHistory } from "./useSongHistory";

const notifyError = vi.hoisted(() => vi.fn());

vi.mock("@/composables/useNotify", () => ({ useNotify: () => ({ notifyError, notifySuccess: vi.fn() }) }));

vi.mock("@/pocketbase/db", () => ({
  dbGetOne: vi.fn(async (_collection: string, id: string) => ({ id })),
  dbUpdate: vi.fn(async (_collection: string, id: string, data: object) => ({ id, ...data })),
}));

type Setup = {
  history: SongHistoryControls;
  song: Ref<Song | undefined>;
  editMode: Ref<boolean>;
  stop: () => void;
};

function setup(initial: Song): Setup {
  const song = shallowRef<Song | undefined>(initial);
  const editMode = ref(true);
  const scope = effectScope();
  const history = scope.run(() => useSongHistory(song, editMode))!;
  return { history, song, editMode, stop: () => scope.stop() };
}

function press(key: string, modifiers: KeyboardEventInit = {}, target: EventTarget = window): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, ...modifiers }));
}

async function toggleSegue(song: Song): Promise<void> {
  await song.editLayers({ segue: !song.hasSegue() });
}

describe("useSongHistory", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("undoes with Ctrl+Z and redoes with Ctrl+Shift+Z and Ctrl+Y", async () => {
    const song = makeAudioSongWithRepeat();
    const { history, stop } = setup(song);
    await toggleSegue(song);
    await toggleSegue(song);
    expect(history.canUndo.value).toBe(true);

    press("z");
    await flushPromises();
    expect(song.hasSegue()).toBe(true);
    press("z");
    await flushPromises();
    expect(song.hasSegue()).toBe(false);
    expect(history.canUndo.value).toBe(false);

    press("Z", { shiftKey: true });
    await flushPromises();
    expect(song.hasSegue()).toBe(true);
    press("y");
    await flushPromises();
    expect(song.hasSegue()).toBe(false);
    expect(history.canRedo.value).toBe(false);
    stop();
  });

  it("leaves the keys to a focused text field", async () => {
    const song = makeAudioSongWithRepeat();
    const { stop } = setup(song);
    await toggleSegue(song);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    press("z", {}, input);
    await flushPromises();

    expect(song.hasSegue()).toBe(true);
    stop();
  });

  it("starts a new history for another song and when the editor closes", async () => {
    const song = makeAudioSongWithRepeat();
    const { history, song: current, editMode, stop } = setup(song);
    await toggleSegue(song);

    current.value = makeAudioSongWithRepeat();
    await nextTick();
    expect(history.canUndo.value).toBe(false);
    current.value = song;
    await nextTick();
    expect(history.canUndo.value).toBe(false);

    await toggleSegue(song);
    editMode.value = false;
    await nextTick();
    expect(history.canUndo.value).toBe(false);
    await history.undo();
    expect(song.hasSegue()).toBe(false);
    stop();
  });

  it("shows a toast when the song changed elsewhere", async () => {
    const song = makeAudioSongWithRepeat();
    const { history, stop } = setup(song);
    await toggleSegue(song);
    vi.mocked(dbGetOne).mockResolvedValueOnce({ id: song.id, updated: "elsewhere" });

    await history.undo();

    expect(notifyError).toHaveBeenCalledWith("Could not undo", expect.objectContaining({ message: expect.stringContaining("Someone else changed the song") }));
    expect(song.hasSegue()).toBe(true);
    expect(history.canUndo.value).toBe(false);
    stop();
  });
});
