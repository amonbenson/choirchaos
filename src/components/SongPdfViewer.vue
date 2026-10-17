<script setup lang="ts">
import { onLongPress, useEventListener } from "@vueuse/core";
import SelectButton from "primevue/selectbutton";
import { computed, type ComputedRef, type Ref, ref, watch } from "vue";

import { injectMeasureEditor, type MeasureTool } from "@/composables/useMeasureEditor";
import Measure, { type MeasureLayout, needsReview } from "@/core/models/measure";
import { getReadingOrder, intersects, normalizeLayout, splitLayout } from "@/core/models/measureEditing";
import Song from "@/core/models/song";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import { resolveUrl } from "@/core/utils/file";
import { usePlayerStore } from "@/stores/player";

import Draggable from "./Draggable.vue";
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

const TOOL_OPTIONS: { label: string; value: MeasureTool; icon: string }[] = [
  { label: "Select", value: "select", icon: "pi pi-arrow-up-left" },
  { label: "Draw", value: "draw", icon: "pi pi-stop" },
];

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
  const interaction = tool.value === "draw" || previewing.value ? "pointer-events-none" : "";
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
    return [isMeasureHighlighted(measure) ? "bg-sky-400/25 hover:bg-sky-400/45" : "bg-primary/0 hover:bg-primary/25"];
  }

  const interaction = tool.value === "draw" || previewing.value ? "pointer-events-none" : "";
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
  return tool.value === "select" && editor.selection.value.length === 1 && editor.isSelected(measure);
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

// ── Selecting ─────────────────────────────────────────────────────────────────

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

function findMeasureAt(target: EventTarget | null): Measure | undefined {
  const value = (target as HTMLElement | null)?.closest<HTMLElement>("[data-measure]")?.dataset.measure;
  return value === undefined ? undefined : editor.measures.value.find(measure => measure.value === value);
}

// On touch a long press starts multi-select, after which taps add and remove boxes.
onLongPress(overlayRoot, (event) => {
  const measure = findMeasureAt(event.target);
  if (!props.editMode || tool.value !== "select" || event.pointerType === "mouse" || !measure) {
    return;
  }

  touchMultiSelect.value = true;
  suppressNextClick = true;
  if (!editor.isSelected(measure)) {
    editor.toggle(measure);
  }
});

useEventListener("keydown", (event: KeyboardEvent) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (!props.editMode || event.key !== "Escape" || typing) {
    return;
  }

  if (pendingBox.value) {
    pendingBox.value = undefined;
  } else {
    editor.clearSelection();
  }
});

// ── Dragging a marquee or a new box ───────────────────────────────────────────

const MIN_BOX_SIZE = 0.005;
const dragRect = ref<MeasureLayout | undefined>();
let dragAdditive = false;

function pageRelative(e: PointerEvent, el: EventTarget): { x: number; y: number } {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}

function onUnnumberedClick(box: MeasureLayout): void {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  editor.selectBox(box);
}

function onPagePointerDown(e: PointerEvent, page: number): void {
  if (previewing.value) {
    return;
  }

  const onEmptySpace = e.target === e.currentTarget;
  const marquee = tool.value === "select" && e.pointerType === "mouse" && onEmptySpace;
  if (e.button !== 0 || !(tool.value === "draw" || marquee)) {
    return;
  }

  const pos = pageRelative(e, e.currentTarget!);
  dragRect.value = { page, x: pos.x, y: pos.y, width: 0, height: 0 };
  dragAdditive = e.shiftKey || e.ctrlKey || e.metaKey;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onPagePointerMove(e: PointerEvent): void {
  if (!dragRect.value) {
    return;
  }

  const pos = pageRelative(e, e.currentTarget!);
  dragRect.value = { ...dragRect.value, width: pos.x - dragRect.value.x, height: pos.y - dragRect.value.y };
}

function onPagePointerUp(): void {
  const rect = dragRect.value && normalizeLayout(dragRect.value);
  dragRect.value = undefined;
  if (!rect) {
    return;
  }

  const isClick = rect.width < MIN_BOX_SIZE || rect.height < MIN_BOX_SIZE;
  if (tool.value === "draw") {
    if (!isClick) {
      pendingBox.value = rect;
    }

    return;
  }

  const hits = (measuresByPage.value[rect.page] ?? []).filter(measure => intersects(measure.layout!, rect));
  if (isClick && !dragAdditive) {
    editor.clearSelection();
  } else if (dragAdditive) {
    editor.addToSelection(getReadingOrder(hits));
  } else {
    editor.setSelection(getReadingOrder(hits));
  }
}

function onPageClick(e: MouseEvent): void {
  if (props.editMode && tool.value === "select" && lastPointerType !== "mouse" && e.target === e.currentTarget) {
    editor.clearSelection();
  }
}

// Panning by touch would fight drawing, so the draw tool keeps touches on the page to itself.
function stopTouchWhileDrawing(e: TouchEvent): void {
  if (tool.value === "draw") {
    e.stopPropagation();
  }
}

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
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    @loading-change="emit('pdf-loading', $event)"
  >
    <template #default="{ visiblePages }">
      <div
        ref="overlayRoot"
        class="pointer-events-none absolute inset-0"
        @pointerdown.capture="rememberPointerType"
      >
        <div
          v-for="page of visiblePages"
          :key="page.pageNumber"
          :ref="(el) => setPageDivRef(el as Element | null, page.pageNumber)"
          class="absolute"
          :class="{
            'pointer-events-auto': editMode,
            'cursor-crosshair': editMode && tool === 'draw',
          }"
          :style="{
            left: `${page.x * 100}%`,
            top: `${page.y * 100}%`,
            width: `${page.width * 100}%`,
            height: `${page.height * 100}%`,
          }"
          :data-testid="editMode ? 'score-page' : undefined"
          @pointerdown="editMode && onPagePointerDown($event, page.pageNumber)"
          @pointermove="onPagePointerMove"
          @pointerup="onPagePointerUp"
          @pointercancel="onPagePointerUp"
          @click="onPageClick"
          @touchstart="stopTouchWhileDrawing"
          @touchmove="stopTouchWhileDrawing"
        >
          <div
            v-for="measure of visibleMeasures(page.pageNumber)"
            :key="measure.value"
            class="pointer-events-auto absolute cursor-pointer transition-colors select-none"
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
            class="pointer-events-auto absolute cursor-pointer transition-colors select-none"
            :class="unnumberedClass(box)"
            :style="boxStyle(box)"
            role="button"
            aria-label="Box without a number"
            :aria-pressed="editor.isBoxSelected(box)"
            @contextmenu.stop.prevent
            @click="onUnnumberedClick(box)"
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
            v-if="dragRect?.page === page.pageNumber"
            class="pointer-events-none absolute border border-primary"
            :class="tool === 'draw' ? 'bg-primary/20' : 'border-dashed bg-primary/10'"
            :style="boxStyle(normalizeLayout(dragRect))"
          />
        </div>
      </div>

      <SelectButton
        v-if="editMode"
        :model-value="tool"
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
          <i :class="option.icon" />
          <span>{{ option.label }}</span>
        </template>
      </SelectButton>
    </template>
  </PdfViewer>
</template>
