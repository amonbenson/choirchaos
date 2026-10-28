import { computed, type ComputedRef, inject, type InjectionKey, provide, type Ref, ref, type ShallowRef, shallowRef, watch } from "vue";

import type { MeasureId } from "@/core/models/measure";
import type { RecordedPass } from "@/core/models/recording";
import {
  findMeasureRuns,
  getSelectableMeasures,
  NO_SELECTION,
  pickRun,
  resolveSelection,
  type SelectedObjects,
  type Selection,
  selectMeasureRange,
  selectMeasures,
  toggleMeasure,
} from "@/core/models/selection";
import type Song from "@/core/models/song";
import { findSyncPosition } from "@/core/models/warpEditing";
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
  /** Selects the measure at a timeline position and moves the playhead there, so that pass can be edited or synced. */
  selectPosition: (position: number) => void;
  /** Selects a clicked measure alone, toggles it, or selects the range from the last one clicked. */
  clickMeasure: (id: MeasureId, intent: ClickIntent) => void;
  selectAllMeasures: () => void;
  clear: () => void;
};

export type ClickIntent = "select" | "toggle" | "range";

/** On touch a long press starts multi-select, after which taps toggle. With a mouse, Ctrl/Cmd toggles and Shift selects a range. */
export function getClickIntent(event: MouseEvent, pointerType: string, touchMultiSelect: boolean): ClickIntent {
  if (pointerType !== "mouse") {
    return touchMultiSelect ? "toggle" : "select";
  }

  if (event.shiftKey) {
    return "range";
  }

  return event.ctrlKey || event.metaKey ? "toggle" : "select";
}

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

  const run = computed(() => pickRun(runs.value, player.currentTimelinePosition?.position));

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
        // The end sync point has no measure of its own, so the playhead goes to the last measure it ends.
        const position = findSyncPosition(timeline, next.place);
        if (position !== undefined) {
          player.seekPosition(Math.min(position, timeline.length - 1));
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

  function selectPosition(position: number): void {
    const entry = song.value?.getTimeline()[position];
    const selectable = entry && song.value && getSelectableMeasures(song.value).some(measure => measure.id === entry.measure);
    select(selectable ? selectMeasures([entry.measure]) : NO_SELECTION);
    player.seekPosition(position);
  }

  function clickMeasure(id: MeasureId, intent: ClickIntent): void {
    const current = selection.value;
    if (intent === "range") {
      select(selectMeasureRange(song.value ? getSelectableMeasures(song.value) : [], current, id));
    } else {
      select(intent === "toggle" ? toggleMeasure(current, id) : selectMeasures([id]));
    }
  }

  function selectAllMeasures(): void {
    select(selectMeasures(song.value ? getSelectableMeasures(song.value).map(measure => measure.id) : []));
  }

  function clear(): void {
    select(NO_SELECTION);
  }

  watch(song, clear);
  watch(editMode, clear);

  return { selection, selected, runs, run, touchMultiSelect, select, selectAndSeek, selectPosition, clickMeasure, selectAllMeasures, clear };
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
