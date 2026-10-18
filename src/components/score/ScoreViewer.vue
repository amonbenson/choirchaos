<script setup lang="ts">
import { onLongPress, useEventListener } from "@vueuse/core";
import SelectButton from "primevue/selectbutton";
import { computed, type ComputedRef, type Ref, ref, shallowRef, watch } from "vue";

import Draggable from "@/components/base/Draggable.vue";
import { injectMeasureEditor, type MeasureTool } from "@/composables/useMeasureEditor";
import Measure, { type MeasureLayout, needsReview } from "@/core/models/measure";
import { getReadingOrder, intersects, normalizeLayout, splitLayout } from "@/core/models/measureEditing";
import Song from "@/core/models/song";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import { resolveUrl } from "@/core/utils/file";
import { usePlayerStore } from "@/stores/player";

import PdfViewer from "./PdfViewer.vue";

const player = usePlayerStore();
const editor = injectMeasureEditor();
const { tool, pendingBox, pendingCount, touchMultiSelect, detection, revealRequest } = editor;

const props = defineProps<{
  song?: Song;
  editMode?: boolean;
}>();

const emit = defineEmits<{
  "pdf-loading": [loading: boolean];
}>();

const pdfViewer = ref();
const overlayRoot = ref<HTMLElement>();

// ── Measure data ──────────────────────────────────────────────────────────────

const measuresByPage = computed<{ [key: number]: Measure[] }>(() => {
  if (!props.song) {
    return {};
  }

  const groups: { [key: number]: Measure[] } = {};
  for (const measure of props.song.measures.items()) {
    if (measure.layout) {
      const p = measure.layout.page;
      if (!Array.isArray(groups[p])) {
        groups[p] = [];
      }

      groups[p].push(measure);
    }
  }

  return groups;
});

// ── Detection preview and review marks ───────────────────────────────────────

type PreviewBox = {
  value?: string;
  layout: MeasureLayout;
};

const previewing = computed(() => !!props.editMode && !!detection.plan.value);

const previewByPage = computed(() => {
  const plan = props.editMode ? detection.plan.value : undefined;
  if (!plan) {
    return {};
  }

  const boxes: PreviewBox[] = [
    ...plan.placements.map(({ measure, layout }) => ({ value: measure.value, layout })),
    ...plan.additions.map(measure => ({ value: measure.value, layout: measure.layout! })),
    ...plan.unnumbered.map(layout => ({ layout })),
  ];
  return groupByPage(boxes, box => box.layout);
});

const replacedMeasures = computed(() => new Set(detection.plan.value?.placements.map(placement => placement.measure.value)));

const unnumberedByPage = computed(() => props.editMode ? groupByPage(editor.unnumberedBoxes.value, box => box) : {});

function groupByPage<T>(items: readonly T[], layoutOf: (item: T) => MeasureLayout): { [key: number]: T[] } {
  const groups: { [key: number]: T[] } = {};
  for (const item of items) {
    const page = layoutOf(item).page;
    groups[page] = [...groups[page] ?? [], item];
  }

  return groups;
}

function visibleMeasures(page: number): Measure[] {
  const measures = measuresByPage.value[page] ?? [];
  return previewing.value ? measures.filter(measure => !replacedMeasures.value.has(measure.value)) : measures;
}

const CHIP_CLASS = "pointer-events-none absolute top-0 left-0 rounded-br-sm px-1 text-[0.625rem] leading-4 font-semibold";

function chipClass(layout: MeasureLayout | undefined, numbered: boolean): string[] {
  if (!numbered) {
    return [CHIP_CLASS, "bg-red-500 text-white"];
  }

  return [CHIP_CLASS, needsReview(layout) ? "bg-amber-400 text-amber-950" : "bg-primary text-primary-contrast"];
}

function previewClass(box: PreviewBox): string {
  if (box.value === undefined) {
    return "border-red-500 bg-red-500/10";
  }

  return needsReview(box.layout) ? "border-amber-500 bg-amber-400/15" : "border-primary bg-primary/10";
}

function unnumberedClass(box: MeasureLayout): string[] {
  const interaction = activeTool.value === "draw" || previewing.value ? "pointer-events-none" : "";
  const state = editor.isBoxSelected(box)
    ? "border-2 border-primary bg-primary/30"
    : "border-2 border-red-500/80 bg-red-500/10 hover:bg-red-500/20";
  return [interaction, state, previewing.value ? "opacity-40" : ""];
}

const highlightedTracks: ComputedRef<Set<number>> = computed(
  () => new Set(props.song?.tracks.flatMap((t, i) => t.mixer.highlight ? [i] : []) ?? []),
);

function isMeasureHighlighted(measure: Measure): boolean {
  for (const i of measure.$activeTrackIndices) {
    if (highlightedTracks.value.has(i)) {
      return true;
    }
  }

  return false;
}

function boxStyle(layout: MeasureLayout): Record<string, string> {
  return {
    left: `${layout.x * 100}%`,
    top: `${layout.y * 100}%`,
    width: `${layout.width * 100}%`,
    height: `${layout.height * 100}%`,
  };
}

function boxClass(measure: Measure): string[] {
  if (!props.editMode) {
    return ["cursor-pointer", isMeasureHighlighted(measure) ? "bg-sky-400/25 hover:bg-sky-400/45" : "bg-primary/0 hover:bg-primary/25"];
  }

  const interaction = activeTool.value === "draw" || previewing.value ? "pointer-events-none" : "";
  return [interaction, measureStateClass(measure), previewing.value ? "opacity-40" : ""];
}

function measureStateClass(measure: Measure): string {
  if (editor.isSelected(measure)) {
    return "border-2 border-primary bg-primary/30";
  }

  return needsReview(measure.layout)
    ? "border-2 border-amber-500 bg-amber-400/15 hover:bg-amber-400/30"
    : "border border-primary/70 bg-primary/10 hover:bg-primary/25";
}

function hasHandles(measure: Measure): boolean {
  return activeTool.value !== "draw" && editor.selection.value.length === 1 && editor.isSelected(measure);
}

// ── Playback sync ─────────────────────────────────────────────────────────────

const currentPlayingMeasure: Ref<Measure | undefined> = ref();
const currentWrittenMeasure: Ref<Measure | undefined> = ref();

watch(() => player.position, () => {
  currentPlayingMeasure.value = props.song?.findMeasure(player.currentMeasure[0]);
  currentWrittenMeasure.value = props.song?.findMeasure(player.currentMeasure[0], true);
  pdfViewer.value?.redrawOverlay();
});

watch(() => props.song, () => {
  if (props.song) {
    pdfViewer.value?.zoomToPage(0);
    pdfViewer.value?.redrawAll();
    currentPlayingMeasure.value = props.song?.measures.first();
    currentWrittenMeasure.value = props.song?.measures.first();
  }
});

const currentPlayingMeasureProgress = computed(() => {
  if (!currentPlayingMeasure.value) {
    return 0;
  }

  const mStart = currentPlayingMeasure.value.$beatTicks[0] ?? 0;
  const mLength = currentPlayingMeasure.value.$tickLength ?? 960;
  return Math.max(0, Math.min(1, (player.position - mStart) / mLength));
});

watch(highlightedTracks, () => {
  pdfViewer.value?.redrawOverlay();
});

// ── Auto-scroll to current measure ───────────────────────────────────────────

watch(currentWrittenMeasure, () => {
  const layout = currentWrittenMeasure.value?.layout;
  if (layout) {
    scrollToLayout(layout);
  }
});

watch(revealRequest, (request) => {
  if (request) {
    scrollToLayout(request.layout);
  }
});

function scrollToLayout(layout: MeasureLayout): void {
  if (!pdfViewer.value) {
    return;
  }

  const tl: PageCoordinate = { x: layout.x, y: layout.y, p: layout.page };
  const br: PageCoordinate = { x: layout.x + layout.width, y: layout.y + layout.height, p: layout.page };
  const isVisible = (): boolean => pdfViewer.value.isLocationVisible(tl) && pdfViewer.value.isLocationVisible(br);

  if (isVisible()) {
    return;
  }

  const center: PageCoordinate = { x: 0.5, y: layout.y + layout.height / 2, p: layout.page };
  pdfViewer.value.moveToLocation(center, { axis: "horizontal" });

  if (!isVisible()) {
    pdfViewer.value.moveToLocation(center, { axis: "both" });
  }

  if (!isVisible()) {
    pdfViewer.value.moveToLocation(
      { x: layout.x + layout.width / 2, y: layout.y + layout.height / 2, p: layout.page },
      { axis: "both" },
    );
  }

  pdfViewer.value.redrawAll();
}

// ── Tools ─────────────────────────────────────────────────────────────────────

const TOOL_OPTIONS: { label: string; value: MeasureTool; icon: string }[] = [
  { label: "Select", value: "select", icon: "pi pi-arrow-up-left" },
  { label: "Move", value: "move", icon: "pi pi-arrows-alt" },
  { label: "Draw", value: "draw", icon: "pi pi-stop" },
];

const TOOL_CURSORS: Record<MeasureTool, string> = {
  select: "cursor-default",
  move: "cursor-grab active:cursor-grabbing",
  draw: "cursor-crosshair",
};

const shiftHeld = ref(false);

/** The tool the score works with. Holding Shift switches to Select for as long as it is held. */
const activeTool = computed<MeasureTool>(() => shiftHeld.value ? "select" : tool.value);

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function isSelectAll(event: KeyboardEvent): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "a";
}

useEventListener("keydown", (event: KeyboardEvent) => {
  if (!props.editMode || isTyping(event.target)) {
    return;
  }

  if (event.key === "Shift") {
    shiftHeld.value = true;
  } else if (isSelectAll(event) && !previewing.value) {
    event.preventDefault();
    editor.selectAll();
  } else if (event.key === "Escape") {
    cancelOrDeselect();
  }
});

useEventListener("keyup", (event: KeyboardEvent) => {
  if (event.key === "Shift") {
    shiftHeld.value = false;
  }
});

useEventListener("blur", () => {
  shiftHeld.value = false;
});

function cancelOrDeselect(): void {
  if (pendingBox.value) {
    pendingBox.value = undefined;
  } else {
    editor.clearSelection();
  }
}

// ── Clicking boxes ────────────────────────────────────────────────────────────

let lastPointerType: string = "mouse";
let suppressNextClick = false;

function rememberPointerType(event: PointerEvent): void {
  lastPointerType = event.pointerType;
}

function onBoxClick(event: MouseEvent, measure: Measure): void {
  if (!props.editMode) {
    player.setMeasure(measure.value);
    return;
  }

  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  if (lastPointerType !== "mouse") {
    if (touchMultiSelect.value) {
      editor.toggle(measure);
    } else {
      editor.selectOnly(measure);
    }
  } else if (event.shiftKey) {
    editor.selectRange(measure);
  } else if (event.ctrlKey || event.metaKey) {
    editor.toggle(measure);
  } else {
    editor.selectOnly(measure);
  }
}

function onUnnumberedClick(event: MouseEvent, box: MeasureLayout): void {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  const toggles = lastPointerType === "mouse" ? event.shiftKey || event.ctrlKey || event.metaKey : touchMultiSelect.value;
  if (toggles) {
    editor.toggleBox(box);
  } else {
    editor.selectBox(box);
  }
}

function pageAt(target: EventTarget | null): number | undefined {
  const value = (target as Element | null)?.closest<HTMLElement>("[data-page]")?.dataset.page;
  return value === undefined ? undefined : Number(value);
}

function isOnBox(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest("[data-measure], [data-unnumbered-box]");
}

function findMeasureAt(target: EventTarget | null): Measure | undefined {
  const value = (target as Element | null)?.closest<HTMLElement>("[data-measure]")?.dataset.measure;
  return value === undefined ? undefined : editor.measures.value.find(measure => measure.value === value);
}

function findUnnumberedBoxAt(target: EventTarget | null): MeasureLayout | undefined {
  const index = (target as Element | null)?.closest<HTMLElement>("[data-unnumbered-box]")?.dataset.unnumberedBox;
  const page = pageAt(target);
  return index === undefined || page === undefined ? undefined : unnumberedByPage.value[page]?.[Number(index)];
}

function selectForMultiSelect(target: EventTarget | null): boolean {
  const measure = findMeasureAt(target);
  if (measure) {
    if (!editor.isSelected(measure)) {
      editor.toggle(measure);
    }

    return true;
  }

  const box = findUnnumberedBoxAt(target);
  if (box && !editor.isBoxSelected(box)) {
    editor.toggleBox(box);
  }

  return !!box;
}

// On touch a long press starts multi-select, after which taps add and remove boxes. The box is
// selected before the mode starts, because a selection of one box ends multi-select.
onLongPress(overlayRoot, (event) => {
  if (!props.editMode || activeTool.value === "draw" || event.pointerType === "mouse" || previewing.value) {
    return;
  }

  if (selectForMultiSelect(event.target)) {
    touchMultiSelect.value = true;
    suppressNextClick = true;
  }
});

// ── Gestures ──────────────────────────────────────────────────────────────────

type ScreenPoint = { x: number; y: number };

/**
 * One press on the score, in screen coordinates so a marquee can start beside the pages and reach
 * across them. It keeps the tool it started with and becomes a drag once it moves. With the Move
 * tool the viewer pans the drag, so only its taps matter here.
 */
type Gesture = {
  tool: MeasureTool;
  page?: number;
  start: ScreenPoint;
  end: ScreenPoint;
  dragging: boolean;
  onBox: boolean;
  additive: boolean;
  keepsSelection: boolean;
};

const MIN_DRAG_PIXELS = 4;
const MIN_BOX_SIZE = 0.005;
const gesture = shallowRef<Gesture>();

function screenPoint(e: PointerEvent): ScreenPoint {
  return { x: e.clientX, y: e.clientY };
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !e.isPrimary || previewing.value) {
    return;
  }

  gesture.value = {
    tool: activeTool.value,
    page: pageAt(e.target),
    start: screenPoint(e),
    end: screenPoint(e),
    dragging: false,
    onBox: isOnBox(e.target),
    additive: e.ctrlKey || e.metaKey,
    keepsSelection: e.shiftKey || e.ctrlKey || e.metaKey,
  };
}

// The pointer is captured only once a drag starts, because a capture retargets the click of a tap
// away from the box under the pointer.
function onPointerMove(e: PointerEvent): void {
  const current = gesture.value;
  if (!current) {
    return;
  }

  const end = screenPoint(e);
  const dragging = current.dragging || Math.hypot(end.x - current.start.x, end.y - current.start.y) >= MIN_DRAG_PIXELS;
  if (dragging && !current.dragging && current.tool !== "move") {
    overlayRoot.value?.setPointerCapture(e.pointerId);
  }

  gesture.value = { ...current, end, dragging };
}

function onPointerUp(): void {
  const current = gesture.value;
  gesture.value = undefined;
  if (!current) {
    return;
  }

  if (!current.dragging) {
    finishTap(current);
  } else if (current.tool === "select") {
    finishMarquee(current);
  } else if (current.tool === "draw" && current.page !== undefined) {
    finishDrawing(current, current.page);
  }
}

/** Boxes handle their own clicks, so a tap here only clears the selection on empty space. */
function finishTap(current: Gesture): void {
  if (current.tool !== "draw" && !current.onBox && !current.keepsSelection) {
    editor.clearSelection();
  }
}

function finishMarquee(current: Gesture): void {
  const { measures, boxes } = findMarqueeHits(current);
  if (current.additive) {
    editor.addToSelection(measures, boxes);
  } else {
    editor.setSelection(measures, boxes);
  }
}

function finishDrawing(current: Gesture, page: number): void {
  const rect = dragOnPage(current, page);
  if (rect && rect.width >= MIN_BOX_SIZE && rect.height >= MIN_BOX_SIZE) {
    pendingBox.value = clampToPage(rect);
  }
}

/** The gesture relative to a page. It may reach beyond the page. */
function dragOnPage(current: Gesture, page: number): MeasureLayout | undefined {
  const rect = pageDivRefs.get(page)?.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) {
    return undefined;
  }

  return normalizeLayout({
    page,
    x: (current.start.x - rect.left) / rect.width,
    y: (current.start.y - rect.top) / rect.height,
    width: (current.end.x - current.start.x) / rect.width,
    height: (current.end.y - current.start.y) / rect.height,
  });
}

function clampToPage(layout: MeasureLayout): MeasureLayout {
  const x = Math.max(0, layout.x);
  const y = Math.max(0, layout.y);
  return { page: layout.page, x, y, width: Math.min(1, layout.x + layout.width) - x, height: Math.min(1, layout.y + layout.height) - y };
}

function findMarqueeHits(current: Gesture): { measures: Measure[]; boxes: MeasureLayout[] } {
  const measures: Measure[] = [];
  const boxes: MeasureLayout[] = [];
  for (const page of pageDivRefs.keys()) {
    const rect = dragOnPage(current, page);
    if (rect) {
      measures.push(...visibleMeasures(page).filter(measure => intersects(measure.layout!, rect)));
      boxes.push(...(unnumberedByPage.value[page] ?? []).filter(box => intersects(box, rect)));
    }
  }

  return { measures: getReadingOrder(measures), boxes };
}

const drawnRect = computed(() => {
  const current = gesture.value;
  return current?.dragging && current.tool === "draw" && current.page !== undefined ? dragOnPage(current, current.page) : undefined;
});

const marqueeStyle = computed(() => {
  const current = gesture.value;
  const root = overlayRoot.value?.getBoundingClientRect();
  if (!current?.dragging || current.tool !== "select" || !root) {
    return undefined;
  }

  const { start, end } = current;
  return {
    left: `${Math.min(start.x, end.x) - root.left}px`,
    top: `${Math.min(start.y, end.y) - root.top}px`,
    width: `${Math.abs(end.x - start.x)}px`,
    height: `${Math.abs(end.y - start.y)}px`,
  };
});

const pendingParts = computed(() => pendingBox.value ? splitLayout(pendingBox.value, Math.max(1, pendingCount.value)) : []);

// ── Resize handles ────────────────────────────────────────────────────────────

type HandleDirection = "top" | "right" | "bottom" | "left";

const HANDLES: { direction: HandleDirection; position: string; cursor: string }[] = [
  { direction: "top", position: "top-0 left-1/2", cursor: "cursor-ns-resize" },
  { direction: "right", position: "top-1/2 left-full", cursor: "cursor-ew-resize" },
  { direction: "bottom", position: "top-full left-1/2", cursor: "cursor-ns-resize" },
  { direction: "left", position: "top-1/2 left-0", cursor: "cursor-ew-resize" },
];

const pageDivRefs = new Map<number, HTMLElement>();

function setPageDivRef(el: Element | null, pageNumber: number): void {
  if (el instanceof HTMLElement) {
    pageDivRefs.set(pageNumber, el);
  } else {
    pageDivRefs.delete(pageNumber);
  }
}

function isSimilar(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

function sameStaff(measure: Measure): Measure[] {
  return (measuresByPage.value[measure.layout!.page] ?? []).filter(other =>
    isSimilar(other.layout!.y, measure.layout!.y)
    && isSimilar(other.layout!.y + other.layout!.height, measure.layout!.y + measure.layout!.height),
  );
}

function onHandleDrag(event: any, measure: Measure, handle: HandleDirection): void {
  if (!props.song) {
    return;
  }

  const pageEl = pageDivRefs.get(measure.layout!.page);
  if (!pageEl) {
    return;
  }

  const dx = event.delta.x / pageEl.clientWidth;
  const dy = event.delta.y / pageEl.clientHeight;
  const staff = sameStaff(measure);

  switch (handle) {
    case "top":
      staff.forEach((m) => {
        props.song!.applyMeasureLayout(m, { ...m.layout!, y: m.layout!.y + dy, height: m.layout!.height - dy });
      });
      break;
    case "bottom":
      staff.forEach((m) => {
        props.song!.applyMeasureLayout(m, { ...m.layout!, height: m.layout!.height + dy });
      });
      break;
    case "left": {
      const left = staff[staff.indexOf(measure) - 1];
      if (left) {
        props.song.applyMeasureLayout(left, { ...left.layout!, width: left.layout!.width + dx });
      }

      props.song.applyMeasureLayout(measure, { ...measure.layout!, x: measure.layout!.x + dx, width: measure.layout!.width - dx });
      break;
    }

    case "right": {
      const right = staff[staff.indexOf(measure) + 1];
      props.song.applyMeasureLayout(measure, { ...measure.layout!, width: measure.layout!.width + dx });
      if (right) {
        props.song.applyMeasureLayout(right, { ...right.layout!, x: right.layout!.x + dx, width: right.layout!.width - dx });
      }

      break;
    }
  }
}
</script>

<template>
  <PdfViewer
    ref="pdfViewer"
    class="@container"
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    :pannable="!editMode || activeTool === 'move'"
    @loading-change="emit('pdf-loading', $event)"
  >
    <template #default="{ visiblePages }">
      <!-- While editing, the overlay takes every press on the score and turns it into a gesture -->
      <div
        ref="overlayRoot"
        class="absolute inset-0"
        :class="editMode ? ['pointer-events-auto', TOOL_CURSORS[activeTool]] : 'pointer-events-none'"
        @pointerdown.capture="rememberPointerType"
        @pointerdown="editMode && onPointerDown($event)"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="gesture = undefined"
      >
        <div
          v-for="page of visiblePages"
          :key="page.pageNumber"
          :ref="(el) => setPageDivRef(el as Element | null, page.pageNumber)"
          class="absolute"
          :style="{
            left: `${page.x * 100}%`,
            top: `${page.y * 100}%`,
            width: `${page.width * 100}%`,
            height: `${page.height * 100}%`,
          }"
          :data-testid="editMode ? 'score-page' : undefined"
          :data-page="page.pageNumber"
        >
          <div
            v-for="measure of visibleMeasures(page.pageNumber)"
            :key="measure.value"
            class="pointer-events-auto absolute transition-colors select-none"
            :class="boxClass(measure)"
            :style="boxStyle(measure.layout!)"
            role="button"
            :aria-label="`Measure ${measure.value}`"
            :aria-pressed="editMode ? editor.isSelected(measure) : undefined"
            :data-measure="measure.value"
            @contextmenu.stop.prevent
            @click="onBoxClick($event, measure)"
          >
            <span
              v-if="editMode"
              :class="chipClass(measure.layout, true)"
            >{{ measure.value }}</span>

            <!-- Playbar -->
            <div
              v-if="currentWrittenMeasure?.value === measure.value && currentPlayingMeasure"
              class="pointer-events-none absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-primary"
              :style="{ left: `${currentPlayingMeasureProgress * 100}%` }"
            />

            <template v-if="editMode && hasHandles(measure)">
              <Draggable
                v-for="handle in HANDLES"
                :key="handle.direction"
                @drag="onHandleDrag($event, measure, handle.direction)"
                @dragend="song?.saveMeasures()"
              >
                <template #default="{ passRef }">
                  <div
                    :ref="(el) => el && passRef(el)"
                    class="absolute flex size-5 -translate-1/2 items-center justify-center"
                    :class="[handle.position, handle.cursor]"
                    :aria-label="`Resize ${handle.direction}`"
                    @pointerdown.stop
                    @click.stop
                    @touchstart.stop
                    @touchmove.stop
                  >
                    <span class="pointer-events-none size-2.5 rounded-full bg-primary ring-2 ring-surface-0 dark:ring-surface-900" />
                  </div>
                </template>
              </Draggable>
            </template>
          </div>

          <div
            v-for="(box, i) of unnumberedByPage[page.pageNumber] ?? []"
            :key="`unnumbered-${i}`"
            class="pointer-events-auto absolute transition-colors select-none"
            :class="unnumberedClass(box)"
            :style="boxStyle(box)"
            role="button"
            aria-label="Box without a number"
            :aria-pressed="editor.isBoxSelected(box)"
            :data-unnumbered-box="i"
            @contextmenu.stop.prevent
            @click="onUnnumberedClick($event, box)"
          >
            <span :class="chipClass(box, false)">?</span>
          </div>

          <div
            v-for="(box, i) of previewByPage[page.pageNumber] ?? []"
            :key="`preview-${i}`"
            class="pointer-events-none absolute border-2 border-dashed"
            :class="previewClass(box)"
            :style="boxStyle(box.layout)"
            data-detection-preview
          >
            <span :class="chipClass(box.layout, box.value !== undefined)">{{ box.value ?? "?" }}</span>
          </div>

          <!-- Box waiting for the panel to say what it holds -->
          <div
            v-for="(part, i) in pendingBox?.page === page.pageNumber ? pendingParts : []"
            :key="`pending-${i}`"
            class="pointer-events-none absolute border border-dashed border-primary bg-primary/20"
            :style="boxStyle(part)"
          />

          <div
            v-if="drawnRect?.page === page.pageNumber"
            class="pointer-events-none absolute border border-primary bg-primary/20"
            :style="boxStyle(drawnRect)"
          />
        </div>

        <div
          v-if="marqueeStyle"
          class="pointer-events-none absolute border border-dashed border-primary bg-primary/10"
          :style="marqueeStyle"
        />
      </div>

      <SelectButton
        v-if="editMode"
        :model-value="activeTool"
        class="absolute top-2 left-1/2 -translate-x-1/2 shadow-sm"
        :options="TOOL_OPTIONS"
        option-label="label"
        option-value="value"
        :allow-empty="false"
        :disabled="previewing"
        aria-label="Score tool"
        size="small"
        @update:model-value="editor.setTool($event)"
      >
        <template #option="{ option }">
          <i
            :class="option.icon"
            aria-hidden="true"
          />
          <span class="sr-only @sm:not-sr-only">{{ option.label }}</span>
        </template>
      </SelectButton>
    </template>
  </PdfViewer>
</template>
