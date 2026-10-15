<script setup lang="ts">
import { useEventListener, useMutationObserver, useResizeObserver } from "@vueuse/core";
import Peaks, { type PeaksInstance, type PeaksOptions, type PlayerAdapter, type Point, type PointOptions } from "peaks.js";
import ProgressSpinner from "primevue/progressspinner";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import WaveformData from "waveform-data";

import { getAnchoredStartTime, normalizeWheelDelta, ZoomLadder } from "@/core/utils/zoom";

import { createLabelledPointMarkerFactory } from "./waveformMarker";

export type WaveformMarker = {
  id: string;
  time: number;
  label: string;
};

const props = defineProps<{
  audioBuffer?: AudioBuffer;
  currentTime: number;
  markers: WaveformMarker[];
  /** Limits where a marker may be dragged to. Returns the allowed time closest to the requested one. */
  constrainMarker?: (id: string, time: number) => number;
}>();

const emit = defineEmits<{
  seek: [time: number];
  markerMove: [id: string, time: number];
  markerClick: [id: string, event: MouseEvent];
}>();

// Full sample resolution costs 2 bytes per sample. Longer recordings start one level coarser.
const MAX_FULL_RESOLUTION_SAMPLES = 16 * 1024 * 1024;
const ZOOM_STEPS_PER_DOUBLING = 4;
const BUTTON_ZOOM_STEPS = 2;

const root = useTemplateRef<HTMLElement>("root");
const zoomviewContainer = useTemplateRef<HTMLElement>("zoomview");
const scrollbarContainer = useTemplateRef<HTMLElement>("scrollbar");
const colorProbe = useTemplateRef<HTMLElement>("colorProbe");

const loading = ref(false);
const scale = ref(0);

let peaks: PeaksInstance | undefined;
let playerEvents: Parameters<PlayerAdapter["init"]>[0] | undefined;
let cachedWaveform: ArrayBuffer | undefined;
let zoomValue = 0;
let ladder: ZoomLadder | undefined;
let buildGeneration = 0;

// Theme tokens can be var() references or color-mix() expressions, which canvas cannot parse.
// Resolving them through an element's computed color always yields a plain rgb() value.
function resolveColor(cssValue: string): string {
  const probe = colorProbe.value!;
  probe.style.color = cssValue;
  return getComputedStyle(probe).color;
}

function getThemeOptions(): Pick<PeaksOptions, "zoomview" | "pointMarkerColor" | "fontFamily" | "createPointMarker"> & { scrollbarColor: string } {
  const muted = resolveColor("var(--p-text-muted-color)");
  const primary = resolveColor("var(--p-primary-color)");

  return {
    fontFamily: getComputedStyle(root.value!).fontFamily,
    pointMarkerColor: primary,
    createPointMarker: createLabelledPointMarkerFactory({ background: primary, text: resolveColor("var(--p-primary-contrast-color)") }),
    scrollbarColor: resolveColor("var(--p-content-border-color)"),
    zoomview: {
      waveformColor: muted,
      playheadColor: primary,
      axisLabelColor: muted,
      axisGridlineColor: resolveColor("var(--p-content-border-color)"),
      fontSize: 11,
      showPlayheadTime: true,
      playheadTextColor: primary,
      wheelMode: "scroll",
    },
  };
}

function getSampleRate(): number {
  return props.audioBuffer?.sampleRate ?? 44100;
}

function getFitScale(): number {
  const width = zoomviewContainer.value?.clientWidth || 1;
  return Math.max(getBaseScale(), Math.ceil((props.audioBuffer?.length ?? 0) / width));
}

function getBaseScale(): number {
  return Math.max(1, Math.ceil((props.audioBuffer?.length ?? 0) / MAX_FULL_RESOLUTION_SAMPLES));
}

const playerAdapter: PlayerAdapter = {
  init: async (events) => {
    playerEvents = events;
    events.emit("player.canplay");
  },
  destroy: () => {
    playerEvents = undefined;
  },
  play: async () => {},
  pause: () => {},
  isPlaying: () => false,
  isSeeking: () => false,
  getCurrentTime: () => props.currentTime,
  getDuration: () => props.audioBuffer?.duration ?? 0,
  seek: time => emit("seek", time),
};

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
  return { id: marker.id, time: marker.time, labelText: marker.label, editable: true, color };
}

function attachEvents(instance: PeaksInstance): void {
  instance.on("points.dragmove", ({ point }) => {
    const allowed = props.constrainMarker?.(point.id!, point.time) ?? point.time;
    if (allowed !== point.time) {
      point.update({ time: allowed });
    }
  });

  instance.on("points.dragend", ({ point }) => emit("markerMove", point.id!, point.time));

  instance.on("points.click", ({ point, evt, preventViewEvent }) => {
    preventViewEvent();
    emit("markerClick", point.id!, evt);
  });

  instance.on("points.contextmenu", ({ point, evt, preventViewEvent }) => {
    preventViewEvent();
    evt.preventDefault();
    emit("markerClick", point.id!, evt);
  });

  instance.on("zoom.update", ({ currentZoom }) => {
    scale.value = currentZoom;
  });
}

function destroyPeaks(): void {
  peaks?.destroy();
  peaks = undefined;
}

async function buildPeaks(): Promise<void> {
  const generation = ++buildGeneration;
  // Rebuilding for a theme change keeps the scroll position, a new recording starts at the beginning.
  const previousStart = cachedWaveform ? peaks?.views.getView("zoomview")?.getStartTime() : undefined;
  destroyPeaks();

  if (!props.audioBuffer || !zoomviewContainer.value || !scrollbarContainer.value) {
    return;
  }

  const baseScale = getBaseScale();
  if (!cachedWaveform) {
    loading.value = true;
    const waveform = await createWaveformData(props.audioBuffer, baseScale);
    if (generation !== buildGeneration) {
      return;
    }

    cachedWaveform = waveform;
  }

  const { scrollbarColor, ...theme } = getThemeOptions();
  const options: PeaksOptions = {
    ...theme,
    zoomview: { ...theme.zoomview, container: zoomviewContainer.value },
    scrollbar: { container: scrollbarContainer.value, color: scrollbarColor, minWidth: 40 },
    player: playerAdapter,
    keyboard: false,
    zoomLevels: [Math.max(baseScale, zoomValue || getFitScale())],
    points: props.markers.map(marker => toPoint(marker, theme.pointMarkerColor!)),
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
  ladder ??= new ZoomLadder({ min: baseScale, max: props.audioBuffer.length, stepsPerDoubling: ZOOM_STEPS_PER_DOUBLING });
  zoomValue ||= getFitScale();
  scale.value = Math.max(baseScale, Math.floor(zoomValue));
  attachEvents(instance);

  if (previousStart !== undefined) {
    instance.views.getView("zoomview")?.setStartTime(previousStart);
  }

  loading.value = false;
}

function setZoom(nextValue: number, anchorX?: number): void {
  const view = peaks?.views.getView("zoomview");
  if (!view || !ladder) {
    return;
  }

  const width = zoomviewContainer.value!.clientWidth;
  const x = anchorX ?? width / 2;
  const anchorTime = view.getStartTime() + (x / width) * (view.getEndTime() - view.getStartTime());

  zoomValue = Math.min(getFitScale(), nextValue);
  view.setZoom({ scale: Math.max(getBaseScale(), Math.floor(zoomValue)) });
  view.setStartTime(getAnchoredStartTime(anchorTime, x, Math.floor(zoomValue), getSampleRate()));
}

function zoomIn(): void {
  setZoom(ladder?.step(zoomValue, -BUTTON_ZOOM_STEPS) ?? zoomValue);
}

function zoomOut(): void {
  setZoom(ladder?.step(zoomValue, BUTTON_ZOOM_STEPS) ?? zoomValue);
}

function fit(): void {
  zoomValue = getFitScale();
  peaks?.views.getView("zoomview")?.setZoom({ seconds: "auto" });
}

// Plain wheel input is left to peaks, which scrolls the waveform. Ctrl and pinch gestures zoom.
useEventListener(zoomviewContainer, "wheel", (event: WheelEvent) => {
  if (!event.ctrlKey && !event.metaKey) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (!ladder) {
    return;
  }

  const next = ladder.applyWheel(zoomValue, normalizeWheelDelta(event));
  if (next !== zoomValue) {
    const rect = zoomviewContainer.value!.getBoundingClientRect();
    setZoom(next, event.clientX - rect.left);
  }
}, { capture: true, passive: false });

function resetWaveform(): void {
  cachedWaveform = undefined;
  ladder = undefined;
  zoomValue = 0;
  buildPeaks();
}

// Not an immediate watcher: that would run during setup, before the containers exist.
onMounted(resetWaveform);
watch(() => props.audioBuffer, resetWaveform);

watch(() => props.currentTime, (time) => {
  playerEvents?.emit("player.timeupdate", time);
});

watch(() => props.markers, (markers) => {
  if (!peaks) {
    return;
  }

  const color = getThemeOptions().pointMarkerColor!;
  peaks.points.removeAll();
  peaks.points.add(markers.map(marker => toPoint(marker, color)));
}, { deep: true });

useMutationObserver(document.documentElement, () => buildPeaks(), { attributes: true, attributeFilter: ["class"] });

useResizeObserver(zoomviewContainer, () => {
  peaks?.views.getView("zoomview")?.fitToContainer();
  peaks?.views.getScrollbar()?.fitToContainer();
});

onBeforeUnmount(() => {
  buildGeneration++;
  destroyPeaks();
});

defineExpose({ zoomIn, zoomOut, fit, getPoints: (): Point[] => peaks?.points.getPoints() ?? [] });
</script>

<template>
  <div
    ref="root"
    class="relative flex size-full flex-col"
    :data-zoom-scale="scale"
    :data-sample-rate="audioBuffer?.sampleRate"
  >
    <span
      ref="colorProbe"
      class="hidden"
    />
    <div
      ref="zoomview"
      class="min-h-0 flex-1"
      data-testid="waveform"
    />
    <div
      ref="scrollbar"
      class="h-3 flex-none"
    />
    <div
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center"
    >
      <ProgressSpinner class="size-10" />
    </div>
  </div>
</template>
