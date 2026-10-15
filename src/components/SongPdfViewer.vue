<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Popover from "primevue/popover";
import Select from "primevue/select";
import { computed, type ComputedRef, nextTick, type Ref, ref, watch } from "vue";

import Measure, { type MeasureLayout } from "@/core/models/measure";
import Song from "@/core/models/song";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import { resolveUrl } from "@/core/utils/file";
import { getAccessFlags, NoPermissions } from "@/pocketbase/auth";
import { useAuthStore } from "@/stores/auth";
import { usePlayerStore } from "@/stores/player";

import Draggable from "./Draggable.vue";
import PdfViewer from "./PdfViewer.vue";

const player = usePlayerStore();
const auth = useAuthStore();

const props = defineProps<{
  song?: Song;
  editMode?: boolean;
}>();

const emit = defineEmits<{
  "pdf-loading": [loading: boolean];
}>();

const access = computed(() => getAccessFlags(props.song?.permissions ?? NoPermissions, auth.user?.id));
const currentTool = ref<"edit" | "add">("edit");
const pdfViewer = ref();

watch(() => props.editMode, (value) => {
  if (!value) {
    currentTool.value = "edit";
  }
});

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
  if (!pdfViewer.value) {
    return;
  }

  const layout: MeasureLayout | undefined = currentWrittenMeasure.value?.layout;
  if (!layout) {
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
});

// ── Draw layout ───────────────────────────────────────────────────────────────

const drawRect = ref<MeasureLayout | undefined>();

function pageRelative(e: PointerEvent, el: EventTarget): { x: number; y: number } {
  const rect = (el as HTMLElement).getBoundingClientRect();
  return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
}

function onDrawStart(e: PointerEvent, page: number): void {
  const pos = pageRelative(e, e.currentTarget!);
  drawRect.value = { page, x: pos.x, y: pos.y, width: 0, height: 0 };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onDrawMove(e: PointerEvent): void {
  if (!drawRect.value) {
    return;
  }

  const pos = pageRelative(e, e.currentTarget!);
  drawRect.value = { ...drawRect.value, width: pos.x - drawRect.value.x, height: pos.y - drawRect.value.y };
}

// The drawn box stays visible while the popover asks how many measures it holds.
const MIN_BOX_SIZE = 0.005;
const pendingRect = ref<MeasureLayout | undefined>();
const pendingRectElement = ref<HTMLElement>();
const splitPopover = ref();
const splitCount = ref(4);

const unplacedMeasures = computed(() => props.song?.measures.items().filter(m => !m.layout) ?? []);

async function onDrawEnd(): Promise<void> {
  const rect = drawRect.value;
  drawRect.value = undefined;

  if (!rect || !props.song || Math.abs(rect.width) < MIN_BOX_SIZE || Math.abs(rect.height) < MIN_BOX_SIZE) {
    return;
  }

  pendingRect.value = {
    page: rect.page,
    x: Math.min(rect.x, rect.x + rect.width),
    y: Math.min(rect.y, rect.y + rect.height),
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
  splitCount.value = Math.max(1, Math.min(splitCount.value, unplacedMeasures.value.length));

  await nextTick();
  splitPopover.value.show({ currentTarget: pendingRectElement.value }, pendingRectElement.value);
}

async function confirmSplit(): Promise<void> {
  const rect = pendingRect.value;
  const measures = unplacedMeasures.value.slice(0, splitCount.value);
  splitPopover.value.hide();

  if (!rect || !props.song || measures.length === 0) {
    return;
  }

  measures.forEach((measure, i) => {
    props.song!.applyMeasureLayout(measure, {
      page: rect.page,
      x: rect.x + (rect.width / measures.length) * i,
      y: rect.y,
      width: rect.width / measures.length,
      height: rect.height,
    });
  });

  await props.song.saveMeasures();
}

const measurePopover = ref();
const selectedMeasure = ref<Measure>();

const measureOptions = computed(() => (props.song?.measures.items() ?? []).map(m => ({
  value: m.value,
  label: m.layout && m !== selectedMeasure.value ? `${m.value} (swap)` : m.value,
})));

function openMeasureOptions(event: Event, measure: Measure): void {
  selectedMeasure.value = measure;
  measurePopover.value.show(event);
}

async function reassignSelectedMeasure(value: string): Promise<void> {
  const measure = selectedMeasure.value;
  measurePopover.value.hide();

  if (measure && props.song) {
    await props.song.reassignMeasureLayout(measure, value);
    pdfViewer.value?.redrawOverlay();
  }
}

function removeSelectedLayout(): void {
  measurePopover.value.hide();

  if (selectedMeasure.value) {
    deleteMeasureLayout(selectedMeasure.value);
  }
}

// ── Resize handles ────────────────────────────────────────────────────────────

type HandleDirection = "top" | "right" | "bottom" | "left";

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

function deleteMeasureLayout(measure: Measure): void {
  props.song?.applyMeasureLayout(measure, undefined);
  props.song?.saveMeasures();
}
</script>

<template>
  <PdfViewer
    ref="pdfViewer"
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    @loading-change="emit('pdf-loading', $event)"
  >
    <template #default="{ visiblePages }">
      <!-- Measure Overlays -->
      <div
        v-for="page of visiblePages"
        :key="page.pageNumber"
        :ref="(el) => setPageDivRef(el as Element | null, page.pageNumber)"
        class="absolute"
        :class="currentTool === 'add'
          ? 'pointer-events-auto cursor-crosshair'
          : 'pointer-events-none cursor-default'"
        :style="{
          left: `${page.x * 100}%`,
          top: `${page.y * 100}%`,
          width: `${page.width * 100}%`,
          height: `${page.height * 100}%`,
        }"
      >
        <div
          v-for="measure of (measuresByPage[page.pageNumber] ?? []).filter(m => m.layout)"
          :key="measure.value"
          class="pointer-events-auto absolute transition-colors select-none"
          :class="[
            editMode ? 'cursor-pointer border border-primary bg-primary/25 hover:bg-primary/45' : 'cursor-pointer',
            !editMode && (isMeasureHighlighted(measure) ? 'bg-sky-400/25 hover:bg-sky-400/45' : 'bg-primary/0 hover:bg-primary/25'),
          ]"
          :style="{
            left: `${measure.layout!.x * 100}%`,
            top: `${measure.layout!.y * 100}%`,
            width: `${measure.layout!.width * 100}%`,
            height: `${measure.layout!.height * 100}%`,
          }"
          role="button"
          :aria-label="`Measure ${measure.value}`"
          @contextmenu.stop
          @click="editMode ? openMeasureOptions($event, measure) : player.setMeasure(measure.value)"
        >
          <!-- Measure number (edit mode) -->
          <div
            v-if="editMode"
            class="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 text-2xl font-bold text-black"
          >
            {{ measure.value }}
          </div>

          <!-- Playbar -->
          <div
            v-if="currentWrittenMeasure?.value === measure.value && currentPlayingMeasure"
            class="absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-primary"
            :style="{ left: `${currentPlayingMeasureProgress * 100}%` }"
          />

          <!-- Resize handles (edit mode) -->
          <template v-if="editMode">
            <Draggable
              @drag="onHandleDrag($event, measure, 'top')"
              @dragend="song?.saveMeasures()"
            >
              <template #default="{ passRef }">
                <Button
                  :ref="(c: any) => c && passRef(c.$el)"
                  class="absolute top-0 left-1/2 -translate-1/2 scale-50 cursor-ns-resize"
                  icon="pi pi-arrows-v"
                  severity="secondary"
                  size="small"
                  rounded
                  pt:icon:class="pointer-events-none"
                  @click.stop
                />
              </template>
            </Draggable>
            <Draggable
              @drag="onHandleDrag($event, measure, 'right')"
              @dragend="song?.saveMeasures()"
            >
              <template #default="{ passRef }">
                <Button
                  :ref="(c: any) => c && passRef(c.$el)"
                  class="absolute top-1/2 left-full -translate-1/2 scale-50 cursor-ew-resize"
                  icon="pi pi-arrows-h"
                  severity="secondary"
                  size="small"
                  rounded
                  pt:icon:class="pointer-events-none"
                  @click.stop
                />
              </template>
            </Draggable>
            <Draggable
              @drag="onHandleDrag($event, measure, 'bottom')"
              @dragend="song?.saveMeasures()"
            >
              <template #default="{ passRef }">
                <Button
                  :ref="(c: any) => c && passRef(c.$el)"
                  class="absolute top-full left-1/2 -translate-1/2 scale-50 cursor-ns-resize"
                  icon="pi pi-arrows-v"
                  severity="secondary"
                  size="small"
                  rounded
                  pt:icon:class="pointer-events-none"
                  @click.stop
                />
              </template>
            </Draggable>
            <Draggable
              @drag="onHandleDrag($event, measure, 'left')"
              @dragend="song?.saveMeasures()"
            >
              <template #default="{ passRef }">
                <Button
                  :ref="(c: any) => c && passRef(c.$el)"
                  class="absolute top-1/2 left-0 -translate-1/2 scale-50 cursor-ew-resize"
                  icon="pi pi-arrows-h"
                  severity="secondary"
                  size="small"
                  rounded
                  pt:icon:class="pointer-events-none"
                  @click.stop
                />
              </template>
            </Draggable>
          </template>
        </div>

        <!-- Box waiting for the measure count -->
        <div
          v-if="pendingRect?.page === page.pageNumber"
          ref="pendingRectElement"
          class="pointer-events-none absolute border border-dashed border-primary bg-primary/20"
          :style="{
            left: `${pendingRect.x * 100}%`,
            top: `${pendingRect.y * 100}%`,
            width: `${pendingRect.width * 100}%`,
            height: `${pendingRect.height * 100}%`,
          }"
        />

        <!-- Draw capture overlay (add mode only) -->
        <div
          v-if="currentTool === 'add'"
          class="absolute inset-0"
          @pointerdown="onDrawStart($event, page.pageNumber)"
          @pointermove="onDrawMove"
          @pointerup="onDrawEnd"
          @pointercancel="onDrawEnd"
        >
          <div
            v-if="drawRect?.page === page.pageNumber"
            class="pointer-events-none absolute border border-primary bg-primary/20"
            :style="{
              left: `${Math.min(drawRect.x, drawRect.x + drawRect.width) * 100}%`,
              top: `${Math.min(drawRect.y, drawRect.y + drawRect.height) * 100}%`,
              width: `${Math.abs(drawRect.width) * 100}%`,
              height: `${Math.abs(drawRect.height) * 100}%`,
            }"
          />
        </div>
      </div>

      <!-- Bottom edit bar -->
      <div
        v-if="access.editor && editMode"
        class="absolute right-2 bottom-2 flex gap-2"
      >
        <Button
          v-tooltip.top="currentTool === 'add' ? 'Drag a box around measures on the score' : undefined"
          icon="pi pi-plus"
          label="Place measures"
          :severity="currentTool === 'add' ? 'primary' : 'secondary'"
          :badge="unplacedMeasures.length > 0 ? String(unplacedMeasures.length) : undefined"
          badge-severity="contrast"
          rounded
          @click="currentTool = currentTool === 'add' ? 'edit' : 'add'"
        />
      </div>

      <Popover
        ref="splitPopover"
        @hide="pendingRect = undefined"
      >
        <form
          class="flex w-64 flex-col gap-3"
          @submit.prevent="confirmSplit"
        >
          <template v-if="unplacedMeasures.length > 0">
            <div class="flex items-center justify-between gap-2">
              <label
                for="split-count"
                class="text-sm font-medium"
              >Measures in this box</label>
              <InputNumber
                v-model="splitCount"
                input-id="split-count"
                :min="1"
                :max="unplacedMeasures.length"
                show-buttons
                button-layout="horizontal"
                size="small"
                input-class="w-12 text-center"
                autofocus
              />
            </div>
            <span class="text-xs text-muted-color">
              Places measure {{ unplacedMeasures[0]!.value }}<template v-if="splitCount > 1"> to {{ unplacedMeasures[Math.min(splitCount, unplacedMeasures.length) - 1]!.value }}</template>.
            </span>
            <Button
              type="submit"
              label="Place"
              size="small"
            />
          </template>
          <span
            v-else
            class="text-sm text-muted-color"
          >All measures are placed. Add more measures in the markers panel first.</span>
        </form>
      </Popover>

      <Popover ref="measurePopover">
        <div
          v-if="selectedMeasure"
          class="flex w-56 flex-col gap-3"
        >
          <div class="flex flex-col gap-1">
            <label
              id="measure-number-label"
              class="text-sm font-medium"
            >Measure number</label>
            <Select
              :model-value="selectedMeasure.value"
              :options="measureOptions"
              option-label="label"
              option-value="value"
              aria-labelledby="measure-number-label"
              size="small"
              scroll-height="16rem"
              filter
              @update:model-value="reassignSelectedMeasure"
            />
            <span class="text-xs text-muted-color">Choosing a measure that is already placed swaps the two.</span>
          </div>
          <Button
            label="Remove from score"
            icon="pi pi-trash"
            severity="danger"
            size="small"
            outlined
            @click="removeSelectedLayout"
          />
        </div>
      </Popover>
    </template>
  </PdfViewer>
</template>
