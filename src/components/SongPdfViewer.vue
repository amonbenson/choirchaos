<script setup lang="ts">
import Button from "primevue/button";
import { computed, type ComputedRef, type Ref, ref, watch } from "vue";

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

async function onDrawEnd(): Promise<void> {
  const rect = drawRect.value;
  drawRect.value = undefined;
  // currentTool.value = "edit";

  if (!rect || !props.song) {
    return;
  }

  const numMeasures = parseInt(prompt("How many measures to add?", "4") ?? "NaN");
  if (isNaN(numMeasures) || numMeasures <= 0) {
    return;
  }

  for (let i = 0; i < numMeasures; i++) {
    const measure = props.song.measures.items().find(m => !m.layout);
    if (!measure) {
      return;
    }

    props.song.applyMeasureLayout(measure, {
      page: rect.page,
      x: rect.x + (rect.width / numMeasures) * i,
      y: rect.y,
      width: rect.width / numMeasures,
      height: rect.height,
    });
  }

  await props.song.saveMeasures();
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
            editMode ? 'cursor-default border border-primary bg-primary/25 hover:bg-primary/45' : 'cursor-pointer',
            !editMode && (isMeasureHighlighted(measure) ? 'bg-sky-400/25 hover:bg-sky-400/45' : 'bg-primary/0 hover:bg-primary/25'),
          ]"
          :style="{
            left: `${measure.layout!.x * 100}%`,
            top: `${measure.layout!.y * 100}%`,
            width: `${measure.layout!.width * 100}%`,
            height: `${measure.layout!.height * 100}%`,
          }"
          @contextmenu.stop
          @click="!editMode && player.setMeasure(measure.value)"
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

          <!-- Delete layout button (edit mode) -->
          <Button
            v-if="editMode"
            class="absolute top-0 right-3 translate-x-1/2 -translate-y-1/2 scale-50"
            icon="pi pi-times"
            severity="danger"
            size="small"
            rounded
            @click.stop="deleteMeasureLayout(measure)"
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
          icon="pi pi-plus"
          label="Layout"
          :severity="currentTool === 'add' ? 'primary' : 'secondary'"
          rounded
          @click="currentTool = currentTool === 'add' ? 'edit' : 'add'"
        />
      </div>
    </template>
  </PdfViewer>
</template>
