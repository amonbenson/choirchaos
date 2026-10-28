import { computed, type ComputedRef, inject, type InjectionKey, provide, type Ref, ref, shallowRef, watch } from "vue";

import type Measure from "@/core/models/measure";
import type { MeasureId, MeasureLayout } from "@/core/models/measure";
import { toMeasureEdit } from "@/core/models/measureDetection";
import type { BoxTarget, MeasureEditMode, PlannedEdit } from "@/core/models/measureEditing";
import { getAdjacentReviewItem, getReviewItemAfter, getReviewItems, isSameReviewItem, type ReviewItem } from "@/core/models/measureReview";
import { type Selection, selectMeasures } from "@/core/models/selection";
import type Song from "@/core/models/song";

import type { EditorSelection } from "./useEditorSelection";
import { type MeasureDetection, useMeasureDetection } from "./useMeasureDetection";
import { useNotify } from "./useNotify";

/** A request to scroll the score to a box. A new object each time, so asking twice scrolls twice. */
export type RevealRequest = { layout: MeasureLayout };

export type MeasureEditor = {
  /** While drawing, a drag on the score draws a box instead of panning. */
  drawing: Ref<boolean>;
  pendingBox: Ref<MeasureLayout | undefined>;
  pendingCount: Ref<number>;
  placeFrom: Ref<string | undefined>;
  saving: Ref<boolean>;
  measures: ComputedRef<readonly Measure[]>;
  mode: ComputedRef<MeasureEditMode>;
  unnumberedBoxes: ComputedRef<readonly MeasureLayout[]>;
  reviewItems: ComputedRef<ReviewItem[]>;
  currentReviewItem: ComputedRef<ReviewItem | undefined>;
  revealRequest: Ref<RevealRequest | undefined>;
  detection: MeasureDetection;
  startDrawing: (from?: string) => void;
  stopDrawing: () => void;
  apply: (planned: PlannedEdit) => Promise<void>;
  placePendingBox: (planned: PlannedEdit) => Promise<void>;
  showReviewItem: (item: ReviewItem) => void;
  stepReview: (direction: 1 | -1) => void;
  resolveReview: (planned: PlannedEdit) => Promise<void>;
  applyDetection: () => Promise<void>;
};

/**
 * Drawing, saving and reviewing boxes in the song editor. A form that planned an edit is left before
 * the edit is saved, so it never plans again against its own saved result, which would see its new
 * measures as conflicts.
 */
export function useMeasureEditor(song: Ref<Song | undefined>, editMode: Ref<boolean>, selection: EditorSelection): MeasureEditor {
  const { notifyError } = useNotify();

  const drawing = ref(false);
  const pendingBox = ref<MeasureLayout>();
  const pendingCount = ref(4);
  const placeFrom = ref<string>();
  const saving = ref(false);
  const revealRequest = shallowRef<RevealRequest>();
  const detection = useMeasureDetection(song, error => notifyError("Could not detect measures", error));

  const measures = computed(() => song.value?.getMeasures() ?? []);
  const mode = computed<MeasureEditMode>(() => song.value?.playerMode === "midi" ? "midi" : "audio");
  const unnumberedBoxes = computed(() => song.value?.getUnnumberedBoxes() ?? []);

  const reviewItems = computed(() => getReviewItems(measures.value, unnumberedBoxes.value));
  const currentReviewItem = computed<ReviewItem | undefined>(() => {
    const current = selection.selected.value;
    const item = current.kind === "measures" && current.measures.length === 1
      ? { layout: current.measures[0]!.layout!, measure: current.measures[0] }
      : current.kind === "boxes" && current.boxes.length === 1 ? { layout: current.boxes[0]! } : undefined;
    return item && reviewItems.value.find(other => isSameReviewItem(other, item));
  });

  function startDrawing(from?: string): void {
    selection.clear();
    pendingBox.value = undefined;
    placeFrom.value = from;
    drawing.value = true;
  }

  function stopDrawing(): void {
    drawing.value = false;
    pendingBox.value = undefined;
    placeFrom.value = undefined;
  }

  // Drawing starts from an empty selection, so selecting something ends it.
  watch(() => selection.selection.value, (next) => {
    if (next.kind !== "none") {
      stopDrawing();
    }
  });

  function resolveTarget(target: BoxTarget, added: readonly Measure[]): MeasureId | undefined {
    return "addition" in target ? added[target.addition]?.id : target.measure;
  }

  async function save({ edit }: PlannedEdit): Promise<readonly Measure[]> {
    const target = song.value;
    if (!target) {
      return [];
    }

    saving.value = true;
    try {
      return await target.applyMeasureEdit(edit);
    } finally {
      saving.value = false;
    }
  }

  /** Saves an edit and selects the boxes it places. The player follows the save on its own, so this never waits for audio. */
  async function apply(planned: PlannedEdit): Promise<void> {
    const added = await save(planned);
    const ids = planned.boxes.map(box => resolveTarget(box, added)).filter(id => id !== undefined);
    selection.select(selectMeasures(ids));
  }

  /** Places the drawn box and keeps drawing, so the next box continues where this one ends. */
  async function placePendingBox(planned: PlannedEdit): Promise<void> {
    const box = pendingBox.value;
    const from = placeFrom.value;
    pendingBox.value = undefined;
    placeFrom.value = undefined;
    try {
      await save(planned);
    } catch (error) {
      pendingBox.value = box;
      placeFrom.value = from;
      throw error;
    }
  }

  function showReviewItem(item: ReviewItem): void {
    selection.select(item.measure ? selectMeasures([item.measure.id]) : { kind: "boxes", boxes: [item.layout] });
    revealRequest.value = { layout: item.layout };
  }

  function stepReview(direction: 1 | -1): void {
    const item = getAdjacentReviewItem(reviewItems.value, currentReviewItem.value, direction);
    if (item) {
      showReviewItem(item);
    }
  }

  /** Moves on to the next item to review and saves the edit that resolves the current one. */
  async function resolveReview(planned: PlannedEdit): Promise<void> {
    const current = currentReviewItem.value;
    const next = current && getReviewItemAfter(reviewItems.value, current);
    const previous: Selection = selection.selection.value;
    if (next) {
      showReviewItem(next);
    } else {
      selection.clear();
    }

    try {
      await save(planned);
    } catch (error) {
      selection.select(previous);
      throw error;
    }
  }

  async function applyDetection(): Promise<void> {
    const target = song.value;
    const plan = detection.plan.value;
    if (!target || !plan) {
      return;
    }

    await save(toMeasureEdit(plan, target.getUnnumberedBoxes()));
    detection.discard();
    selection.clear();
  }

  function reset(): void {
    stopDrawing();
    detection.discard();
  }

  watch(song, reset);
  watch(editMode, reset);

  return {
    drawing,
    pendingBox,
    pendingCount,
    placeFrom,
    saving,
    measures,
    mode,
    unnumberedBoxes,
    reviewItems,
    currentReviewItem,
    revealRequest,
    detection,
    startDrawing,
    stopDrawing,
    apply,
    placePendingBox,
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
