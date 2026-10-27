import { computed, type ComputedRef, type Ref, ref, shallowRef, watch } from "vue";

import type Song from "@/core/models/song";
import SongHistory, { type HistoryState } from "@/core/models/songHistory";

import { useGlobalShortcuts } from "./useGlobalShortcuts";
import { useNotify } from "./useNotify";

type HistoryAction = "undo" | "redo";

const HISTORY_SHORTCUTS: Record<string, HistoryAction> = {
  "Mod+z": "undo",
  "Mod+Shift+z": "redo",
  "Mod+y": "redo",
};

export type SongHistoryControls = {
  canUndo: ComputedRef<boolean>;
  canRedo: ComputedRef<boolean>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

/**
 * The undo history of the song open in the editor, with its keyboard shortcuts. A new song or leaving
 * the editor starts a new history.
 */
export function useSongHistory(song: Ref<Song | undefined>, editMode: Ref<boolean>): SongHistoryControls {
  const { notifyError } = useNotify();
  const history = shallowRef<SongHistory>();
  const state = shallowRef<HistoryState>({ canUndo: false, canRedo: false });
  const busy = ref(false);

  watch([song, editMode], ([current, editing], _, onCleanup) => {
    if (!current || !editing) {
      history.value = undefined;
      state.value = { canUndo: false, canRedo: false };
      return;
    }

    const created = new SongHistory(current);
    const subscription = created.onStateChange(next => state.value = next);
    history.value = created;
    state.value = created.getState();
    onCleanup(() => {
      subscription.dispose();
      created.dispose();
    });
  }, { immediate: true });

  async function run(action: HistoryAction, failure: string): Promise<void> {
    const current = history.value;
    if (!current || busy.value) {
      return;
    }

    busy.value = true;
    try {
      await current[action]();
    } catch (error) {
      notifyError(failure, error);
    } finally {
      busy.value = false;
    }
  }

  const undo = (): Promise<void> => run("undo", "Could not undo");
  const redo = (): Promise<void> => run("redo", "Could not redo");

  useGlobalShortcuts(HISTORY_SHORTCUTS, { undo, redo });

  return {
    canUndo: computed(() => state.value.canUndo && !busy.value),
    canRedo: computed(() => state.value.canRedo && !busy.value),
    undo,
    redo,
  };
}
