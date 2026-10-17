import { computed, type ComputedRef, inject, type InjectionKey, provide, type Ref, ref, shallowRef, toRaw, watch } from "vue";

import type Measure from "@/core/models/measure";
import type { MeasureLayout } from "@/core/models/measure";
import { changesPlayback, getMeasuresBetween, type MeasureEdit, type MeasureEditMode } from "@/core/models/measureEditing";
import type Song from "@/core/models/song";
import type { Numbering } from "@/core/utils/numbering";
import { usePlayerStore } from "@/stores/player";

export type MeasureTool = "select" | "draw";

export type MeasureEditor = {
  tool: Ref<MeasureTool>;
  touchMultiSelect: Ref<boolean>;
  pendingBox: Ref<MeasureLayout | undefined>;
  pendingCount: Ref<number>;
  placeFrom: Ref<Numbering | undefined>;
  saving: Ref<boolean>;
  measures: ComputedRef<Measure[]>;
  mode: ComputedRef<MeasureEditMode>;
  selection: ComputedRef<Measure[]>;
  isSelected: (measure: Measure) => boolean;
  selectOnly: (measure: Measure) => void;
  toggle: (measure: Measure) => void;
  selectRange: (measure: Measure) => void;
  addToSelection: (measures: Measure[]) => void;
  setSelection: (measures: Measure[]) => void;
  clearSelection: () => void;
  setTool: (tool: MeasureTool) => void;
  startPlacing: (value: Numbering) => void;
  apply: (edit: MeasureEdit) => Promise<void>;
  addMeasures: (measures: Measure[]) => Promise<void>;
};

/**
 * Selection, tool and pending box of the song editor, shared by the score and the Measures panel.
 * Measures are kept raw, because the song hands out reactive proxies while new measures of an
 * edit are plain objects.
 */
export function useMeasureEditor(song: Ref<Song | undefined>, editMode: Ref<boolean>): MeasureEditor {
  const player = usePlayerStore();

  const tool = ref<MeasureTool>("select");
  const selected = shallowRef(new Set<Measure>());
  const anchor = shallowRef<Measure>();
  const touchMultiSelect = ref(false);
  const pendingBox = ref<MeasureLayout>();
  const pendingCount = ref(4);
  const placeFrom = ref<Numbering>();
  const saving = ref(false);

  const measures = computed(() => song.value?.measures.items() ?? []);
  const mode = computed<MeasureEditMode>(() => song.value?.playerMode === "midi" ? "midi" : "audio");
  const selection = computed(() => measures.value.filter(measure => measure.layout && selected.value.has(toRaw(measure))));

  function setSelection(next: Measure[]): void {
    selected.value = new Set(next.map(measure => toRaw(measure)));
    anchor.value = next.at(-1) && toRaw(next.at(-1));
    if (next.length === 0) {
      touchMultiSelect.value = false;
    }
  }

  function isSelected(measure: Measure): boolean {
    return selected.value.has(toRaw(measure));
  }

  function selectOnly(measure: Measure): void {
    setSelection([measure]);
  }

  function toggle(measure: Measure): void {
    const next = isSelected(measure)
      ? selection.value.filter(other => toRaw(other) !== toRaw(measure))
      : [...selection.value, measure];
    setSelection(next);
    anchor.value = toRaw(measure);
  }

  function selectRange(measure: Measure): void {
    const from = measures.value.find(other => toRaw(other) === anchor.value) ?? measure;
    const range = getMeasuresBetween(measures.value, from, measure);
    selected.value = new Set(range.map(other => toRaw(other)));
  }

  function addToSelection(added: Measure[]): void {
    setSelection([...selection.value, ...added.filter(measure => !isSelected(measure))]);
  }

  function clearSelection(): void {
    setSelection([]);
  }

  function setTool(next: MeasureTool): void {
    tool.value = next;
    pendingBox.value = undefined;
    if (next === "draw") {
      clearSelection();
    } else {
      placeFrom.value = undefined;
    }
  }

  function startPlacing(value: Numbering): void {
    setTool("draw");
    placeFrom.value = value;
  }

  async function reloadPlayer(target: Song): Promise<void> {
    const position = player.position;
    await player.load(target);
    player.seek(position);
  }

  /** Saves an edit once, reloads the player only when timing changed, and selects the edited boxes. */
  async function apply(edit: MeasureEdit): Promise<void> {
    const target = song.value;
    if (!target) {
      return;
    }

    saving.value = true;
    try {
      await target.applyMeasureEdit(edit);
      const boxes = new Set(edit.boxes.map(measure => toRaw(measure)));
      setSelection(measures.value.filter(measure => measure.layout && boxes.has(toRaw(measure))));
      if (changesPlayback(edit)) {
        await reloadPlayer(target);
      }
    } finally {
      saving.value = false;
    }
  }

  async function addMeasures(added: Measure[]): Promise<void> {
    const target = song.value;
    if (!target) {
      return;
    }

    await target.addMeasures(added);
    await reloadPlayer(target);
  }

  function reset(): void {
    setTool("select");
    clearSelection();
  }

  watch(song, reset);
  watch(editMode, reset);

  return {
    tool,
    touchMultiSelect,
    pendingBox,
    pendingCount,
    placeFrom,
    saving,
    measures,
    mode,
    selection,
    isSelected,
    selectOnly,
    toggle,
    selectRange,
    addToSelection,
    setSelection,
    clearSelection,
    setTool,
    startPlacing,
    apply,
    addMeasures,
  };
}

const MEASURE_EDITOR: InjectionKey<MeasureEditor> = Symbol("measureEditor");

export function provideMeasureEditor(editor: MeasureEditor): void {
  provide(MEASURE_EDITOR, editor);
}

export function injectMeasureEditor(): MeasureEditor {
  const editor = inject(MEASURE_EDITOR);
  if (!editor) {
    throw new Error("injectMeasureEditor() needs provideMeasureEditor() in a parent component");
  }

  return editor;
}
