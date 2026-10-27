import { computed, type ComputedRef, inject, type InjectionKey, provide, type Ref, ref, shallowRef, watch } from "vue";

import type Measure from "@/core/models/measure";
import { isSameLayout, type MeasureId, type MeasureLayout } from "@/core/models/measure";
import { toMeasureEdit } from "@/core/models/measureDetection";
import { type BoxTarget, getMeasuresBetween, getReadingOrder, type MeasureEditMode, type PlannedEdit } from "@/core/models/measureEditing";
import { getAdjacentReviewItem, getReviewItemAfter, getReviewItems, isSameReviewItem, type ReviewItem } from "@/core/models/measureReview";
import { findSectionsAt, findSelectedRuns, getSectionRun, pickRun, type SectionMatch, type SelectedRun } from "@/core/models/measureSelection";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

import { type MeasureDetection, useMeasureDetection } from "./useMeasureDetection";
import { useNotify } from "./useNotify";

/** Select drags a marquee, Move pans the score and Draw adds boxes. Clicks select with all but Draw. */
export type MeasureTool = "select" | "move" | "draw";

const DEFAULT_TOOL: MeasureTool = "move";

/** A request to scroll the score to a box. A new object each time, so asking twice scrolls twice. */
export type RevealRequest = { layout: MeasureLayout };

export type MeasureEditor = {
  tool: Ref<MeasureTool>;
  touchMultiSelect: Ref<boolean>;
  pendingBox: Ref<MeasureLayout | undefined>;
  pendingCount: Ref<number>;
  placeFrom: Ref<string | undefined>;
  saving: Ref<boolean>;
  measures: ComputedRef<readonly Measure[]>;
  mode: ComputedRef<MeasureEditMode>;
  selection: ComputedRef<Measure[]>;
  unnumberedBoxes: ComputedRef<readonly MeasureLayout[]>;
  selectedBoxes: ComputedRef<MeasureLayout[]>;
  selectedBox: ComputedRef<MeasureLayout | undefined>;
  selectionCount: ComputedRef<number>;
  reviewItems: ComputedRef<ReviewItem[]>;
  currentReviewItem: ComputedRef<ReviewItem | undefined>;
  revealRequest: Ref<RevealRequest | undefined>;
  selectedRuns: ComputedRef<SelectedRun[]>;
  selectedRun: ComputedRef<SelectedRun | undefined>;
  sectionMatches: ComputedRef<SectionMatch[]>;
  selectedSection: ComputedRef<SectionMatch | undefined>;
  detection: MeasureDetection;
  isSelected: (measure: Measure) => boolean;
  isBoxSelected: (box: MeasureLayout) => boolean;
  selectBox: (box: MeasureLayout) => void;
  toggleBox: (box: MeasureLayout) => void;
  selectOnly: (measure: Measure) => void;
  toggle: (measure: Measure) => void;
  selectRange: (measure: Measure) => void;
  addToSelection: (measures: Measure[], boxes?: MeasureLayout[]) => void;
  setSelection: (measures: Measure[], boxes?: MeasureLayout[]) => void;
  selectAll: () => void;
  selectSection: (index: number) => void;
  clearSelection: () => void;
  seekMeasure: (measure: Measure) => void;
  seekRun: (run: SelectedRun) => void;
  setTool: (tool: MeasureTool) => void;
  startPlacing: (label: string) => void;
  apply: (planned: PlannedEdit) => Promise<void>;
  showReviewItem: (item: ReviewItem) => void;
  stepReview: (direction: 1 | -1) => void;
  resolveReview: (planned: PlannedEdit) => Promise<void>;
  applyDetection: () => Promise<void>;
};

/**
 * Selection, tool and pending box of the song editor, shared by the score and the inspector.
 * Measures are selected by ID, boxes without a number by position. The selection has no occurrence of
 * its own: the selected run is where the selected measures play at or nearest to the playhead.
 */
export function useMeasureEditor(song: Ref<Song | undefined>, editMode: Ref<boolean>): MeasureEditor {
  const player = usePlayerStore();
  const { notifyError } = useNotify();

  const tool = ref<MeasureTool>(DEFAULT_TOOL);
  const selected = shallowRef(new Set<MeasureId>());
  const anchor = shallowRef<MeasureId>();
  const touchMultiSelect = ref(false);
  const pendingBox = ref<MeasureLayout>();
  const pendingCount = ref(4);
  const placeFrom = ref<string>();
  const saving = ref(false);
  const selectedBoxKeys = shallowRef<MeasureLayout[]>([]);
  const revealRequest = shallowRef<RevealRequest>();
  const detection = useMeasureDetection(song, error => notifyError("Could not detect measures", error));

  const measures = computed(() => song.value?.getMeasures() ?? []);
  const mode = computed<MeasureEditMode>(() => song.value?.playerMode === "midi" ? "midi" : "audio");
  const selection = computed(() => measures.value.filter(measure => measure.layout && selected.value.has(measure.id)));
  const unnumberedBoxes = computed(() => song.value?.getUnnumberedBoxes() ?? []);
  const selectedBoxes = computed(() => unnumberedBoxes.value.filter(box => isBoxSelected(box)));
  const selectionCount = computed(() => selection.value.length + selectedBoxes.value.length);
  // A box without a number has its own form, which only fits when it is the whole selection.
  const selectedBox = computed(() => selection.value.length === 0 && selectedBoxes.value.length === 1 ? selectedBoxes.value[0] : undefined);

  const timeline = computed(() => song.value?.getTimeline() ?? []);
  const selectedRuns = computed(() => selectedBoxes.value.length > 0
    ? []
    : findSelectedRuns(measures.value, timeline.value, new Set(selection.value.map(measure => measure.id))));
  const selectedRun = computed(() => pickRun(selectedRuns.value, player.currentLocation?.position));
  const sectionMatches = computed(() => selectedRun.value
    ? findSectionsAt(timeline.value, song.value?.getSections() ?? [], selectedRun.value)
    : []);
  // Only a section that holds the whole run is edited through it. Partial overlaps are offered to be replaced.
  const selectedSection = computed(() => {
    const [match, ...others] = sectionMatches.value;
    return match && others.length === 0 && match.relation !== "overlaps" ? match : undefined;
  });

  const reviewItems = computed(() => getReviewItems(measures.value, unnumberedBoxes.value));
  const currentReviewItem = computed<ReviewItem | undefined>(() => {
    const single = selection.value.length === 1 ? selection.value[0] : undefined;
    const current = selectedBox.value ? { layout: selectedBox.value } : single && { layout: single.layout!, measure: single };
    return current && reviewItems.value.find(item => isSameReviewItem(item, current));
  });

  // With a single box selected the score shows its resize handles, so touch multi-select ends there
  // and needs another long press.
  function endTouchMultiSelectIfSingle(): void {
    if (selected.value.size + selectedBoxKeys.value.length <= 1) {
      touchMultiSelect.value = false;
    }
  }

  function setSelection(next: Measure[], boxes: MeasureLayout[] = []): void {
    selectedBoxKeys.value = [...boxes];
    selected.value = new Set(next.map(measure => measure.id));
    anchor.value = next.at(-1)?.id;
    endTouchMultiSelectIfSingle();
  }

  function isSelected(measure: Measure): boolean {
    return selected.value.has(measure.id);
  }

  function isBoxSelected(box: MeasureLayout): boolean {
    return selectedBoxKeys.value.some(key => isSameLayout(box, key));
  }

  function selectBox(box: MeasureLayout): void {
    setSelection([], [box]);
  }

  function toggleBox(box: MeasureLayout): void {
    const boxes = isBoxSelected(box)
      ? selectedBoxes.value.filter(other => !isSameLayout(other, box))
      : [...selectedBoxes.value, box];
    const keptAnchor = anchor.value;
    setSelection(selection.value, boxes);
    anchor.value = keptAnchor;
  }

  function selectOnly(measure: Measure): void {
    setSelection([measure]);
  }

  function toggle(measure: Measure): void {
    const next = isSelected(measure)
      ? selection.value.filter(other => other.id !== measure.id)
      : [...selection.value, measure];
    setSelection(next, selectedBoxes.value);
    anchor.value = measure.id;
  }

  function selectRange(measure: Measure): void {
    const range = getMeasuresBetween(measures.value, anchor.value ?? measure.id, measure.id);
    selectedBoxKeys.value = [];
    selected.value = new Set(range.map(other => other.id));
  }

  function addToSelection(added: Measure[], boxes: MeasureLayout[] = []): void {
    setSelection(
      [...selection.value, ...added.filter(measure => !isSelected(measure))],
      [...selectedBoxes.value, ...boxes.filter(box => !isBoxSelected(box))],
    );
  }

  function selectAll(): void {
    stopDrawing();
    setSelection(getReadingOrder(measures.value.filter(measure => measure.layout)), [...unnumberedBoxes.value]);
  }

  function clearSelection(): void {
    setSelection([]);
  }

  /** A measure that plays more than once is entered at the occurrence closest to the playback, so a click stays in the current pass. */
  function seekMeasure(measure: Measure): void {
    const current = player.currentLocation?.position ?? 0;
    const distance = (position: number): number => Math.abs(position - current);
    const nearest = timeline.value
      .filter(entry => entry.measure === measure.id)
      .reduce<number | undefined>((best, { position }) => best === undefined || distance(position) < distance(best) ? position : best, undefined);
    if (nearest !== undefined) {
      player.seekPosition(nearest);
    }
  }

  function seekRun(run: SelectedRun): void {
    player.seekPosition(run.first);
  }

  /** Selects the measures of a section's first pass and moves the playhead there, so the section is the selected run. */
  function selectSection(index: number): void {
    const section = song.value?.getSections()[index];
    const run = section && getSectionRun(timeline.value, section);
    if (!run) {
      return;
    }

    const ids = new Set(timeline.value.slice(run.first, run.last + 1).map(entry => entry.measure));
    stopDrawing();
    setSelection(measures.value.filter(measure => measure.layout && ids.has(measure.id)));
    seekRun(run);
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

  // Drawing starts from an empty selection, so selecting something ends it.
  function stopDrawing(): void {
    if (tool.value === "draw") {
      setTool(DEFAULT_TOOL);
    }
  }

  function startPlacing(label: string): void {
    setTool("draw");
    placeFrom.value = label;
  }

  function resolveTarget(target: BoxTarget, added: readonly Measure[]): MeasureId | undefined {
    return "addition" in target ? added[target.addition]?.id : target.measure;
  }

  /** Saves an edit once and selects the edited boxes. The player follows the save on its own, so this never waits for audio. */
  async function apply({ edit, boxes }: PlannedEdit): Promise<void> {
    const target = song.value;
    if (!target) {
      return;
    }

    saving.value = true;
    try {
      const added = await target.applyMeasureEdit(edit);
      const ids = new Set(boxes.map(box => resolveTarget(box, added)));
      setSelection(measures.value.filter(measure => measure.layout && ids.has(measure.id)));
    } finally {
      saving.value = false;
    }
  }

  function showReviewItem(item: ReviewItem): void {
    stopDrawing();
    if (item.measure) {
      selectOnly(item.measure);
    } else {
      selectBox(item.layout);
    }

    revealRequest.value = { layout: item.layout };
  }

  function stepReview(direction: 1 | -1): void {
    const item = getAdjacentReviewItem(reviewItems.value, currentReviewItem.value, direction);
    if (item) {
      showReviewItem(item);
    }
  }

  /** Applies an edit that resolves the current review item and moves on to the next one. */
  async function resolveReview(planned: PlannedEdit): Promise<void> {
    const current = currentReviewItem.value;
    const next = current && getReviewItemAfter(reviewItems.value, current);
    await apply(planned);
    const fresh = next && reviewItems.value.find(item => isSameReviewItem(item, next));
    if (fresh) {
      showReviewItem(fresh);
    } else if (current) {
      clearSelection();
    }
  }

  async function applyDetection(): Promise<void> {
    const target = song.value;
    const plan = detection.plan.value;
    if (!target || !plan) {
      return;
    }

    const { edit } = toMeasureEdit(plan, target.getUnnumberedBoxes());
    saving.value = true;
    try {
      await target.applyMeasureEdit(edit);
      detection.discard();
      clearSelection();
    } finally {
      saving.value = false;
    }
  }

  function reset(): void {
    setTool(DEFAULT_TOOL);
    clearSelection();
    detection.discard();
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
    unnumberedBoxes,
    selectedBoxes,
    selectedBox,
    selectionCount,
    reviewItems,
    currentReviewItem,
    revealRequest,
    selectedRuns,
    selectedRun,
    sectionMatches,
    selectedSection,
    detection,
    isSelected,
    isBoxSelected,
    selectBox,
    toggleBox,
    selectOnly,
    toggle,
    selectRange,
    addToSelection,
    setSelection,
    selectAll,
    selectSection,
    clearSelection,
    seekMeasure,
    seekRun,
    setTool,
    startPlacing,
    apply,
    showReviewItem,
    stepReview,
    resolveReview,
    applyDetection,
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
