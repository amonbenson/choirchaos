import { computed, type ComputedRef, inject, type InjectionKey, provide, type Ref, ref, type ShallowRef, shallowRef, watch } from "vue";

import type { RecordedPass } from "@/core/models/recording";
import { findPosition } from "@/core/models/recording";
import { findMeasureRuns, NO_SELECTION, pickRun, resolveSelection, type SelectedObjects, type Selection } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

export type EditorSelection = {
  selection: Readonly<ShallowRef<Selection>>;
  /** The selection looked up in the song. Undoing or deleting the selected object leaves nothing selected. */
  selected: ComputedRef<SelectedObjects>;
  /** Every place where the recording plays the selected measures back to back. Empty unless they are consecutive. */
  runs: ComputedRef<RecordedPass[]>;
  /** The run at or nearest to the playhead, so the playhead decides which pass of the measures is edited. */
  run: ComputedRef<RecordedPass | undefined>;
  /** After a long press on touch, taps add and remove measures instead of selecting one. */
  touchMultiSelect: Ref<boolean>;
  select: (next: Selection) => void;
  /** Selects an object and moves the playhead to where it starts, as a click on it in the timeline does. */
  selectAndSeek: (next: Selection) => void;
  clear: () => void;
};

/**
 * The song editor's selection, shared by the score, the inspector and the timeline. It starts over
 * whenever the song changes or the editor closes.
 */
export function useEditorSelection(song: Ref<Song | undefined>, editMode: Ref<boolean>): EditorSelection {
  const player = usePlayerStore();
  const selection = shallowRef<Selection>(NO_SELECTION);
  const touchMultiSelect = ref(false);

  const selected = computed<SelectedObjects>(() => song.value ? resolveSelection(song.value, selection.value) : NO_SELECTION);

  const runs = computed(() => {
    const current = selected.value;
    const target = song.value;
    if (current.kind !== "measures" || !target) {
      return [];
    }

    return findMeasureRuns(target.getMeasures(), target.getTimeline(), current.measures.map(measure => measure.id));
  });

  const run = computed(() => pickRun(runs.value, player.currentLocation?.position));

  // A single measure shows its resize handles, so touch multi-select ends there and needs another long press.
  watch(selected, (current) => {
    if (current.kind !== "measures" || current.measures.length <= 1) {
      touchMultiSelect.value = false;
    }
  });

  function select(next: Selection): void {
    selection.value = next;
  }

  function seekTo(next: SelectedObjects): void {
    const timeline = song.value?.getTimeline() ?? [];
    switch (next.kind) {
      case "section":
        player.seekLocation(next.section.from);
        break;
      case "marker":
        player.seekLocation(next.marker.at);
        break;
      case "syncPoint": {
        const position = findPosition(timeline, next.warpMarker);
        if (position !== undefined) {
          player.seekPosition(position);
        }

        break;
      }

      case "pass":
        player.seekPosition(next.stretch.first);
        break;
    }
  }

  function selectAndSeek(next: Selection): void {
    select(next);
    seekTo(selected.value);
  }

  function clear(): void {
    select(NO_SELECTION);
  }

  watch(song, clear);
  watch(editMode, clear);

  return { selection, selected, runs, run, touchMultiSelect, select, selectAndSeek, clear };
}

const EDITOR_SELECTION: InjectionKey<EditorSelection> = Symbol("editorSelection");

export function provideEditorSelection(selection: EditorSelection): void {
  provide(EDITOR_SELECTION, selection);
}

export function injectEditorSelection(): EditorSelection {
  const selection = inject(EDITOR_SELECTION);
  if (!selection) {
    throw new Error("injectEditorSelection() needs provideEditorSelection() in a parent component");
  }

  return selection;
}
