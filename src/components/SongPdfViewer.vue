<script setup lang="ts">
import Button from "primevue/button";
import { computed, type ComputedRef, type Ref, ref, watch } from "vue";

import Measure from "@/core/models/measure";
import { type MeasureLayout } from "@/core/models/measure";
import Song from "@/core/models/song";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import { resolveUrl } from "@/core/utils/file";
import { getAccessFlags, NoPermissions } from "@/pocketbase/auth";
import { usePlayerStore } from "@/stores/player";

import PdfViewer from "./PdfViewer.vue";

const player = usePlayerStore();

const props = defineProps<{
  song?: Song;
}>();

const emit = defineEmits<{
  "update:editMode": [value: boolean];
}>();

const access = computed(() => getAccessFlags(props.song?.permissions ?? NoPermissions));
const currentTool = ref<"pan" | "edit" | "add">("pan");

watch(currentTool, tool => emit("update:editMode", tool !== "pan"), { immediate: true });

const pdfViewer = ref();

const measuresByPage = computed<{ [key: number]: Measure[] }>(() => {
  if (!props.song) {
    return {};
  }

  // group measures into separate pages
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

const highlightedTracks: ComputedRef<Set<number>> = computed(() => new Set(props.song?.tracks.flatMap((t, i) => t.mixer.highlight ? [i] : []) ?? []));

const currentPlayingMeasure: Ref<Measure | undefined> = ref();
const currentWrittenMeasure: Ref<Measure | undefined> = ref();

watch(() => player.position, () => {
  // Update the current measures
  currentPlayingMeasure.value = props.song?.findMeasure(player.currentMeasure[0]);
  currentWrittenMeasure.value = props.song?.findMeasure(player.currentMeasure[0], true);

  // Update the pdf viewer
  pdfViewer.value?.redrawOverlay();
});

// Move to page 0 and set current measure on song change
watch(() => props.song, () => {
  if (props.song) {
    pdfViewer.value?.zoomToPage(0);
    pdfViewer.value?.redrawAll();

    currentPlayingMeasure.value = props.song?.measures.first();
    currentWrittenMeasure.value = props.song?.measures.first();
  }
});

// Move to next page on measure change
watch(currentWrittenMeasure, () => {
  if (!pdfViewer.value) {
    return;
  }

  const layout: MeasureLayout | undefined = currentWrittenMeasure.value?.layout;
  if (!layout) {
    return;
  }

  const measureTopLeft: PageCoordinate = {
    x: layout.x,
    y: layout.y,
    p: layout.page,
  };
  const measureBottomRight: PageCoordinate = {
    x: layout.x + layout.width,
    y: layout.y + layout.height,
    p: layout.page,
  };

  const isMeasureVisible = (): boolean => pdfViewer.value.isLocationVisible(measureTopLeft) && pdfViewer.value.isLocationVisible(measureBottomRight);

  // If the whole measure is within view, cancel
  if (isMeasureVisible()) {
    return;
  }

  // Get the measure's left edge
  const staffLineCenter: PageCoordinate = {
    x: 0.5,
    y: layout.y + layout.height / 2,
    p: layout.page,
  };

  // Move only the horizontal axis first. If that isn't enough, move both axes
  pdfViewer.value.moveToLocation(staffLineCenter, { axis: "horizontal" });

  // If the measure still isn't visible, move both axes
  if (!isMeasureVisible()) {
    pdfViewer.value.moveToLocation(staffLineCenter, { axis: "both" });
  }

  // If the measure still isn't visible, that means we are so zoomed in, that the full staff width doesn't fit.
  // In that case, move to the center of the measure
  if (!isMeasureVisible()) {
    pdfViewer.value.moveToLocation({
      x: layout.x + layout.width / 2,
      y: layout.y + layout.height / 2,
      p: layout.page,
    }, { axis: "both" });
  }

  pdfViewer.value.redrawAll();
});

// Redraw when track highlighting changes
watch(highlightedTracks, () => {
  pdfViewer.value?.redrawOverlay();
});

const currentPlayingMeasureProgress = computed(() => {
  if (!currentPlayingMeasure.value) {
    return 0;
  }

  const mStart = currentPlayingMeasure.value.$beatTicks[0] ?? 0;
  const mLength = currentPlayingMeasure.value.$tickLength ?? 960;
  return Math.max(0, Math.min(1, (player.position - mStart) / mLength));
});

function isMeasureHighlighted(measure: Measure): boolean {
  for (const i of measure.$activeTrackIndices) {
    if (highlightedTracks.value.has(i)) {
      return true;
    }
  }

  return false;
}

const drawRect = ref<MeasureLayout | undefined>();

function pageRelative(e: PointerEvent, pageEl: EventTarget): { x: number; y: number } {
  const rect = (pageEl as HTMLElement).getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width,
    y: (e.clientY - rect.top) / rect.height,
  };
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
  drawRect.value = {
    ...drawRect.value,
    width: pos.x - drawRect.value.x,
    height: pos.y - drawRect.value.y,
  };
}

function onDrawEnd(): void {
  // Get the drawn rectangle and reset state
  const rect = drawRect.value;
  drawRect.value = undefined;
  currentTool.value = "edit";

  if (!rect) {
    return;
  }

  // Ask the user how many measures to add
  const numMeasures = parseInt(prompt("How many measures to add?", "4") ?? "NaN");
  if (isNaN(numMeasures) || numMeasures <= 0) {
    return;
  }

  // Divide the rectangle into the specified number of measures
  for (let i = 0; i < numMeasures; i++) {
    const measureLayout = {
      page: rect.page,
      x: rect.x + (rect.width / numMeasures) * i,
      y: rect.y,
      width: rect.width / numMeasures,
      height: rect.height,
    } satisfies MeasureLayout;

    // Get the first measure without a layout assigned
    const measure = props.song?.measures.items().find(m => !m.layout);
    if (!measure) {
      return;
    }

    measure.layout = measureLayout;
  }
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
          class="pointer-events-auto absolute cursor-pointer transition-colors select-none"
          :class="[
            currentTool === 'pan'
              ? (isMeasureHighlighted(measure)
                ? 'bg-sky-400/25 hover:bg-sky-400/45'
                : 'bg-primary/0 hover:bg-primary/25')
              : 'border border-primary bg-primary/25 hover:bg-primary/45'
          ]"
          :style="{
            left: `${measure.layout!.x * 100}%`,
            top: `${measure.layout!.y * 100}%`,
            width: `${measure.layout!.width * 100}%`,
            height: `${measure.layout!.height * 100}%`,
          }"
          @contextmenu.stop
          @click="player.setMeasure(measure.value)"
        >
          <!-- Measure number -->
          <div
            v-if="currentTool !== 'pan'"
            class="pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 text-2xl font-bold text-black"
          >
            {{ measure.value }}
          </div>

          <!-- Playbar -->
          <div
            v-if="currentWrittenMeasure?.value === measure.value && currentPlayingMeasure"
            class="absolute top-0 h-full w-[max(1.5%,1px)] -translate-x-1/2 rounded-full bg-primary"
            :style="{ left: `${currentPlayingMeasureProgress * 100}%` }"
          />
        </div>

        <!-- Draw capture overlay (add mode only) — sits above measure divs -->
        <div
          v-if="currentTool === 'add'"
          class="absolute inset-0"
          @pointerdown="onDrawStart($event, page.pageNumber)"
          @pointermove="onDrawMove"
          @pointerup="onDrawEnd"
          @pointercancel="onDrawEnd"
        >
          <!-- Preview rectangle -->
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

      <!-- Edit Buttons -->
      <div
        v-if="access.editor"
        class="absolute top-2 left-12 flex items-center justify-center gap-2"
      >
        <Button
          icon="pi pi-pencil"
          :severity="currentTool === 'pan' ? 'secondary' : 'primary'"
          rounded
          @click="currentTool = currentTool === 'pan' ? 'edit' : 'pan'"
        />

        <Button
          v-if="currentTool !== 'pan'"
          icon="pi pi-plus"
          :severity="currentTool === 'add' ? 'primary' : 'secondary'"
          rounded
          size="small"
          @click="currentTool = currentTool === 'add' ? 'edit' : 'add'"
        />
      </div>

      <!-- Save Button -->
      <div
        v-if="access.editor && currentTool !== 'pan'"
        class="absolute bottom-2 left-2"
      >
        <Button
          icon="pi pi-save"
          label="Save"
          severity="primary"
          rounded
          @click="song?.update()"
        />
      </div>
    </template>
  </PdfViewer>
</template>
