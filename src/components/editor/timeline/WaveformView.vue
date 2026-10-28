<script lang="ts">
// Full sample resolution costs 2 bytes per sample. Longer recordings start one level coarser.
const MAX_FULL_RESOLUTION_SAMPLES = 16 * 1024 * 1024;

/** The closest zoom the waveform draws, in samples per pixel. */
export function getWaveformBaseScale(audioBuffer: AudioBuffer): number {
  return Math.max(1, Math.ceil(audioBuffer.length / MAX_FULL_RESOLUTION_SAMPLES));
}
</script>

<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import Peaks, { type PeaksInstance, type PeaksOptions, type PlayerAdapter, type PointOptions } from "peaks.js";
import ProgressSpinner from "primevue/progressspinner";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import WaveformData from "waveform-data";

import { useCanvasColors } from "@/composables/useCanvasColors";

import { SYNC_POINT_COLORS } from "./syncColors";
import { createLinePointMarkerFactory } from "./waveformMarker";

export type WaveformMarker = {
  id: string;
  time: number;
};

const props = defineProps<{
  audioBuffer?: AudioBuffer;
  /** Samples per pixel, from the timeline's shared axis. */
  scale: number;
  /** Pixels scrolled from the start of the recording, from the timeline's shared axis. */
  offset: number;
  markers: WaveformMarker[];
}>();

// peaks.js turns a start time into a pixel offset by rounding down, so the time aims at the middle of the pixel.
const HALF_PIXEL = 0.5;

const root = useTemplateRef<HTMLElement>("root");
const zoomviewContainer = useTemplateRef<HTMLElement>("zoomview");

const loading = ref(false);
const drawn = ref(false);

let peaks: PeaksInstance | undefined;
let cachedWaveform: ArrayBuffer | undefined;
let buildGeneration = 0;

const colors = useCanvasColors(() => buildPeaks());

// The timeline draws the one playhead and handles every pointer, so peaks.js only draws.
const playerAdapter: PlayerAdapter = {
  init: async events => events.emit("player.canplay"),
  destroy: () => {},
  play: async () => {},
  pause: () => {},
  isPlaying: () => false,
  isSeeking: () => false,
  getCurrentTime: () => 0,
  getDuration: () => props.audioBuffer?.duration ?? 0,
  seek: () => {},
};

function getThemeOptions(): Pick<PeaksOptions, "zoomview" | "fontFamily" | "createPointMarker"> & { pointColor: string } {
  const muted = colors.resolve("var(--p-text-muted-color)");
  const border = colors.resolve("var(--p-content-border-color)");
  const pointColor = colors.resolveVariable(SYNC_POINT_COLORS.variable);

  return {
    pointColor,
    fontFamily: getComputedStyle(root.value!).fontFamily,
    createPointMarker: createLinePointMarkerFactory(pointColor),
    zoomview: {
      waveformColor: muted,
      axisLabelColor: muted,
      axisGridlineColor: border,
      fontSize: 11,
      playheadColor: "transparent",
      playheadWidth: 0,
      showPlayheadTime: false,
      wheelMode: "none",
      autoScroll: false,
    },
  };
}

async function createWaveformData(audioBuffer: AudioBuffer, scale: number): Promise<ArrayBuffer> {
  return await new Promise((resolve, reject) => {
    WaveformData.createFromAudio({ audio_buffer: audioBuffer, scale }, (error, data) => {
      if (error) {
        reject(error);
      } else {
        resolve(data.toArrayBuffer());
      }
    });
  });
}

function toPoint(marker: WaveformMarker, color: string): PointOptions {
  return { id: marker.id, time: marker.time, editable: false, color };
}

function destroyPeaks(): void {
  peaks?.destroy();
  peaks = undefined;
  drawn.value = false;
}

function applyView(): void {
  const view = peaks?.views.getView("zoomview");
  if (!view || !props.audioBuffer) {
    return;
  }

  view.setZoom({ scale: props.scale });
  view.setStartTime(((props.offset + HALF_PIXEL) * props.scale) / props.audioBuffer.sampleRate);
}

function hasSize(): boolean {
  return !!zoomviewContainer.value?.clientWidth && !!zoomviewContainer.value.clientHeight;
}

async function buildPeaks(): Promise<void> {
  const generation = ++buildGeneration;
  destroyPeaks();

  if (!props.audioBuffer || !zoomviewContainer.value) {
    return;
  }

  if (!cachedWaveform) {
    loading.value = true;
    const waveform = await createWaveformData(props.audioBuffer, getWaveformBaseScale(props.audioBuffer));
    if (generation !== buildGeneration) {
      return;
    }

    cachedWaveform = waveform;
  }

  // peaks.js cannot start in a hidden container, e.g. in a phone tab that is not shown. The resize
  // observer builds it once the container gets a size.
  if (!hasSize()) {
    loading.value = false;
    return;
  }

  const { pointColor, ...theme } = getThemeOptions();
  const options: PeaksOptions = {
    ...theme,
    zoomview: { ...theme.zoomview, container: zoomviewContainer.value },
    player: playerAdapter,
    keyboard: false,
    zoomLevels: [props.scale],
    points: props.markers.map(marker => toPoint(marker, pointColor)),
    waveformData: { arraybuffer: cachedWaveform },
  };

  const instance = await new Promise<PeaksInstance | undefined>((resolve) => {
    Peaks.init(options, (error, created) => {
      if (error) {
        console.error(error);
      }

      resolve(created);
    });
  });

  if (generation !== buildGeneration || !instance) {
    instance?.destroy();
    return;
  }

  peaks = instance;
  peaks.views.getView("zoomview")?.enableSeek(false);
  applyView();
  drawn.value = true;
  loading.value = false;
}

function syncPoints(markers: WaveformMarker[]): void {
  if (!peaks) {
    return;
  }

  const pending = new Map(markers.map(marker => [marker.id, marker]));
  for (const point of peaks.points.getPoints()) {
    const marker = pending.get(point.id!);
    pending.delete(point.id!);
    if (!marker) {
      peaks.points.removeById(point.id!);
    } else if (point.time !== marker.time) {
      point.update({ time: marker.time });
    }
  }

  const { pointColor } = getThemeOptions();
  peaks.points.add([...pending.values()].map(marker => toPoint(marker, pointColor)));
}

function resetWaveform(): void {
  cachedWaveform = undefined;
  buildPeaks();
}

// Not an immediate watcher: that would run during setup, before the container exists.
onMounted(resetWaveform);
watch(() => props.audioBuffer, resetWaveform);
watch(() => [props.scale, props.offset], applyView);
watch(() => props.markers, syncPoints, { deep: true });

useResizeObserver(zoomviewContainer, () => {
  if (!peaks && cachedWaveform && hasSize()) {
    buildPeaks();
    return;
  }

  peaks?.views.getView("zoomview")?.fitToContainer();
  applyView();
});

onBeforeUnmount(() => {
  buildGeneration++;
  destroyPeaks();
});
</script>

<template>
  <div
    ref="root"
    class="relative"
    :data-zoom-scale="drawn ? scale : 0"
    :data-sample-rate="audioBuffer?.sampleRate"
  >
    <div
      ref="zoomview"
      class="pointer-events-none size-full"
      role="img"
      aria-label="Waveform"
    />
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center"
    >
      <ProgressSpinner
        class="size-10"
        aria-label="Loading waveform"
      />
    </div>
  </div>
</template>
