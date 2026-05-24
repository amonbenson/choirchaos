<script setup lang="ts">
import { useElementSize, useEventListener } from "@vueuse/core";
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import { computed, ref, watch } from "vue";

import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{ song: Song | undefined }>();

const player = usePlayerStore();

// ── Container & size ────────────────────────────────────────────────────────

const container = ref<HTMLDivElement>();
const { width: W, height: H } = useElementSize(container);

// ── Transform state ──────────────────────────────────────────────────────────

const panX = ref(0); // left-edge of visible window, in seconds
const pxPerSec = ref(100); // horizontal zoom

const totalDuration = computed(() => player.duration / 1000); // ms → s

function timeToX(t: number): number {
  return (t - panX.value) * pxPerSec.value;
}

function xToTime(x: number): number {
  return panX.value + x / pxPerSec.value;
}

function fitToView(): void {
  panX.value = 0;
  if (totalDuration.value > 0 && W.value > 0) {
    pxPerSec.value = W.value / totalDuration.value;
  }
}

// ── Waveform peaks ───────────────────────────────────────────────────────────

const NUM_PEAKS = 10000;
const peaks = ref<{ min: number; max: number }[]>([]);

async function computePeaks(): Promise<void> {
  const buffers = player.player.getAudioBuffers();
  if (buffers.length === 0) {
    peaks.value = [];
    return;
  }

  // Yield to avoid blocking the initial render
  await new Promise(resolve => setTimeout(resolve, 0));

  const dur = Math.min(...buffers.map(b => b.duration));
  const result: { min: number; max: number }[] = [];
  const STEP = 4; // check every 4th sample — fast enough for all reasonable file sizes

  for (let bucket = 0; bucket < NUM_PEAKS; bucket++) {
    const t0 = (bucket / NUM_PEAKS) * dur;
    const t1 = ((bucket + 1) / NUM_PEAKS) * dur;
    let min = 0;
    let max = 0;

    for (const buffer of buffers) {
      const s0 = Math.floor(t0 * buffer.sampleRate);
      const s1 = Math.min(Math.ceil(t1 * buffer.sampleRate), buffer.length);

      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);

        for (let s = s0; s < s1; s += STEP) {
          const v = data[s]!;
          if (v > max) {
            max = v;
          }

          if (v < min) {
            min = v;
          }
        }
      }
    }

    result.push({ min, max });
  }

  peaks.value = result;
}

watch(() => player.status, async (status) => {
  if (status === "ready" && props.song?.playerMode === "audio") {
    await computePeaks();
    fitToView();
  }
}, { immediate: true });

// ── Waveform SVG path ────────────────────────────────────────────────────────

const waveformPath = computed(() => {
  if (!peaks.value.length || !W.value || !H.value || !totalDuration.value) {
    return "";
  }

  const cy = H.value / 2;
  const parts: string[] = [];

  for (let x = 0; x < W.value; x += 2) {
    const t = xToTime(x);
    const bi = Math.floor((t / totalDuration.value) * NUM_PEAKS);
    if (bi < 0 || bi >= peaks.value.length) {
      continue;
    }

    const { min, max } = peaks.value[bi]!;
    const yTop = cy - max * (cy - 2);
    const yBot = cy - min * (cy - 2);
    parts.push(`M${x},${yTop}L${x},${yBot}`);
  }

  return parts.join(" ");
});

// ── Playhead ─────────────────────────────────────────────────────────────────

const isDraggingPlayhead = ref(false);
const draggingPlayheadTime = ref(0);
let playheadDragStartClientX = 0;
let playheadDragStartTime = 0;

const playheadTime = computed(() =>
  isDraggingPlayhead.value ? draggingPlayheadTime.value : player.position / 1000,
);

const playheadX = computed(() => timeToX(playheadTime.value));

function startPlayheadDrag(e: PointerEvent): void {
  isDraggingPlayhead.value = true;
  draggingPlayheadTime.value = player.position / 1000;
  playheadDragStartClientX = e.clientX;
  playheadDragStartTime = player.position / 1000;
}

const playheadGap = computed(() =>
  gaps.value.find(g => playheadTime.value >= g.leftTime && playheadTime.value <= g.rightTime) ?? null,
);

const canAddMarkerAtPlayhead = computed(() => {
  const gap = playheadGap.value;
  return gap !== null
    && gap.count > 0
    && playheadTime.value > 0
    && playheadTime.value < totalDuration.value;
});

async function addMarkerAtPlayhead(): Promise<void> {
  if (!props.song || !canAddMarkerAtPlayhead.value) {
    return;
  }

  const gap = playheadGap.value!;
  const time = playheadTime.value;
  let newIdx: number;

  if (gap.count === 1) {
    newIdx = gap.leftMeasure + 1;
  } else {
    const available = measures.value.slice(gap.leftMeasure + 1, gap.rightMeasure);
    const input = prompt(`Insert warp marker at measure:\nAvailable: ${available.map(m => m.value).join(", ")}`);
    if (!input) {
      return;
    }

    const found = available.findIndex(m => m.value === input.trim());
    if (found === -1) {
      return;
    }

    newIdx = gap.leftMeasure + 1 + found;
  }

  await props.song.addWarpMarker({ measure: newIdx, time });
  reloadWarp();
}

// ── Markers & gaps ───────────────────────────────────────────────────────────

const markers = computed(() => props.song?.warpMarkers ?? []);
const measures = computed(() => props.song?.measures.items() ?? []);

type Gap = {
  leftMeasure: number;
  rightMeasure: number;
  leftTime: number;
  rightTime: number;
  count: number; // available measure slots
};

const gaps = computed((): Gap[] => {
  const ms = markers.value;
  const mc = measures.value.length;
  const edges = [
    { measure: -1, time: 0 },
    ...ms,
    { measure: mc, time: totalDuration.value },
  ];
  return edges.slice(0, -1).map((left, i) => {
    const right = edges[i + 1]!;
    return {
      leftMeasure: left.measure,
      rightMeasure: right.measure,
      leftTime: left.time,
      rightTime: right.time,
      count: right.measure - left.measure - 1,
    };
  });
});

// ── Marker interactions ──────────────────────────────────────────────────────

function reloadWarp(): void {
  if (!props.song) {
    return;
  }

  // TODO validate that the player song is the same as props.song OR drop props.song alltogether and use the player's loaded song as the single source of truth for this panel

  const pos = player.position;
  player.syncWarp();
  player.seek(pos);
}

async function deleteMarker(measure: number): Promise<void> {
  await props.song!.removeWarpMarker(measure);
  reloadWarp();
}

// ── Drag ─────────────────────────────────────────────────────────────────────

// Separate reactive time for the marker being dragged so it updates visually.
const draggingMeasure = ref<number | null>(null);
const dragTime = ref(0);
let dragStartClientX = 0;
let dragStartTime = 0;
let dragLeftBound = 0;
let dragRightBound = 0;

function startDrag(marker: { measure: number; time: number }, e: PointerEvent, gap: Gap, nextGap: Gap): void {
  e.preventDefault();
  draggingMeasure.value = marker.measure;
  dragTime.value = marker.time;
  dragStartClientX = e.clientX;
  dragStartTime = marker.time;
  dragLeftBound = gap.leftTime;
  dragRightBound = nextGap.rightTime;
}

useEventListener(window, "pointermove", (e: PointerEvent) => {
  if (draggingMeasure.value !== null) {
    const dt = (e.clientX - dragStartClientX) / pxPerSec.value;
    dragTime.value = Math.max(dragLeftBound + 0.001, Math.min(dragRightBound - 0.001, dragStartTime + dt));
  }

  if (isDraggingPlayhead.value) {
    const dt = (e.clientX - playheadDragStartClientX) / pxPerSec.value;
    draggingPlayheadTime.value = Math.max(0, Math.min(totalDuration.value, playheadDragStartTime + dt));

    // Seek while dragging
    player.seek(draggingPlayheadTime.value * 1000);
  }
});

useEventListener(window, "pointerup", async () => {
  if (draggingMeasure.value !== null) {
    const measure = draggingMeasure.value;
    draggingMeasure.value = null;
    await props.song!.setWarpMarker(measure, dragTime.value);
    reloadWarp();
  }

  if (isDraggingPlayhead.value) {
    isDraggingPlayhead.value = false;
    player.seek(draggingPlayheadTime.value * 1000);
  }
});

function markerX(marker: { measure: number; time: number }): number {
  return timeToX(draggingMeasure.value === marker.measure ? dragTime.value : marker.time);
}

// ── Wheel ────────────────────────────────────────────────────────────────────

function onWheel(e: WheelEvent): void {
  const rect = container.value!.getBoundingClientRect();
  const cursorX = e.clientX - rect.left;
  const cursorTime = xToTime(cursorX);

  if (e.ctrlKey || e.metaKey) {
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    pxPerSec.value = Math.max(1, pxPerSec.value * factor);
    panX.value = cursorTime - cursorX / pxPerSec.value;
  } else {
    panX.value = Math.max(0, panX.value - e.deltaX / pxPerSec.value);
  }
}
</script>

<template>
  <Panel
    header="Warp"
    pt:root="flex h-48 flex-col overflow-hidden"
    pt:header="flex-none"
    pt:content-container="flex-1 min-h-0 overflow-hidden p-0"
    pt:content-wrapper="h-full"
    pt:content="h-full p-0"
  >
    <template #header>
      <span class="font-bold">Audio Synchronization</span>

      <div class="flex-1" />
      <ButtonGroup>
        <Button
          icon="pi pi-search-minus"
          size="small"
          severity="secondary"
          text
          rounded
          aria-label="Zoom out"
          @click="pxPerSec = Math.max(1, pxPerSec / 1.5)"
        />
        <Button
          icon="pi pi-search-plus"
          size="small"
          severity="secondary"
          text
          rounded
          aria-label="Zoom in"
          @click="pxPerSec *= 1.5"
        />
        <Button
          icon="pi pi-expand"
          size="small"
          severity="secondary"
          text
          rounded
          aria-label="Fit to view"
          @click="fitToView"
        />
      </ButtonGroup>
    </template>

    <!-- Waveform area -->
    <div
      ref="container"
      class="relative size-full overflow-hidden"
      @wheel.prevent="onWheel"
    >
      <!-- Background -->
      <div class="absolute inset-0 bg-surface-100 dark:bg-surface-900" />

      <!-- Amplitude waveform: one bar per 2px bucket -->
      <svg
        v-if="peaks.length"
        class="absolute inset-0 size-full"
      >
        <path
          :d="waveformPath"
          fill="none"
          stroke="var(--p-content-color)"
          stroke-width="2"
          stroke-linecap="round"
          opacity="0.3"
        />
      </svg>

      <!-- Markers -->
      <div
        v-for="(marker, i) in markers"
        :key="marker.measure"
        class="group absolute top-0 bottom-0"
        :style="{ left: `${markerX(marker)}px` }"
      >
        <!-- Vertical bar -->
        <div class="absolute top-6 bottom-0 w-0.5 -translate-x-1/4 rounded-b-full bg-white opacity-80 transition-opacity group-hover:opacity-100" />

        <!-- Label chip + drag handle -->
        <div
          class="absolute top-0 flex h-6 -translate-x-1/2 cursor-ew-resize items-center gap-1 rounded bg-white px-1.5 text-[10px] font-semibold text-black select-none"
          @pointerdown="startDrag(marker, $event, gaps[i]!, gaps[i + 1]!)"
        >
          {{ measures[marker.measure]?.value ?? marker.measure }}
          <span
            class="cursor-pointer leading-none opacity-0 transition-opacity group-hover:opacity-60 hover:opacity-100!"
            title="Delete marker"
            @click.stop="deleteMarker(marker.measure)"
          >x</span>
        </div>

        <!-- Wide invisible drag zone over the line -->
        <div class="absolute top-6 bottom-0 w-3 -translate-x-1/2 cursor-ew-resize" />
      </div>

      <!-- Playhead -->
      <div
        class="group absolute top-0 bottom-0"
        :style="{ left: `${playheadX}px` }"
      >
        <!-- "+" chip: hover to add a warp marker at current measure/time -->
        <div
          v-if="canAddMarkerAtPlayhead && !isDraggingPlayhead"
          class="invisible absolute top-0 z-10 flex h-6 -translate-x-1/2 cursor-pointer items-center rounded bg-primary-400 px-2 text-[10px] font-bold text-white select-none group-hover:visible"
          @pointerdown.stop
          @click.stop="addMarkerAtPlayhead"
        >
          +
        </div>

        <!-- Visible line -->
        <div class="pointer-events-none absolute top-6 bottom-0 w-1 -translate-x-1/2 rounded-b-full bg-primary-400 opacity-80 group-hover:opacity-100" />

        <!-- Drag zone -->
        <div
          class="absolute inset-y-0 w-4 -translate-x-1/2 cursor-ew-resize"
          @pointerdown.prevent="startPlayheadDrag"
        />
      </div>
    </div>
  </Panel>
</template>
