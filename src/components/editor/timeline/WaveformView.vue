<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import Peaks, { type PeaksInstance, type PeaksOptions, type PlayerAdapter } from "peaks.js";
import ProgressSpinner from "primevue/progressspinner";
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";

import { useCanvasColors } from "@/composables/useCanvasColors";
import type { RecordingWaveform } from "@/core/player/audio/waveformData";

const props = defineProps<{
  /** Undefined while it loads, which `loading` tells. */
  waveform?: RecordingWaveform;
  loading?: boolean;
  /** Samples per pixel, from the timeline's shared axis. */
  scale: number;
  /** Pixels scrolled from the start of the recording, from the timeline's shared axis. */
  offset: number;
}>();

// peaks.js turns a start time into a pixel offset by rounding down, so the time aims at the middle of the pixel.
const HALF_PIXEL = 0.5;

const zoomviewContainer = useTemplateRef<HTMLElement>("zoomview");

const building = ref(false);
const drawn = ref(false);
const showsSpinner = computed(() => props.loading || building.value);

let peaks: PeaksInstance | undefined;
let buildGeneration = 0;

const colors = useCanvasColors(() => buildPeaks());

// The timeline draws the playhead, rulers and sync points and handles every pointer, so peaks.js only draws the waveform.
const playerAdapter: PlayerAdapter = {
  init: async events => events.emit("player.canplay"),
  destroy: () => {},
  play: async () => {},
  pause: () => {},
  isPlaying: () => false,
  isSeeking: () => false,
  getCurrentTime: () => 0,
  getDuration: () => props.waveform ? props.waveform.length / props.waveform.sampleRate : 0,
  seek: () => {},
};

function getZoomviewOptions(): PeaksOptions["zoomview"] {
  return {
    waveformColor: colors.resolve("var(--p-text-muted-color)"),
    showAxisLabels: false,
    axisGridlineColor: "transparent",
    playheadColor: "transparent",
    playheadWidth: 0,
    showPlayheadTime: false,
    wheelMode: "none",
    autoScroll: false,
  };
}

function destroyPeaks(): void {
  peaks?.destroy();
  peaks = undefined;
  drawn.value = false;
}

function applyView(): void {
  const view = peaks?.views.getView("zoomview");
  if (!view || !props.waveform) {
    return;
  }

  view.setZoom({ scale: props.scale });
  view.setStartTime(((props.offset + HALF_PIXEL) * props.scale) / props.waveform.sampleRate);
}

function hasSize(): boolean {
  return !!zoomviewContainer.value?.clientWidth && !!zoomviewContainer.value.clientHeight;
}

async function buildPeaks(): Promise<void> {
  const generation = ++buildGeneration;
  destroyPeaks();
  building.value = false;

  const waveform = props.waveform;
  if (!waveform || !zoomviewContainer.value) {
    return;
  }

  // peaks.js cannot start in a hidden container, e.g. in a phone tab that is not shown. The resize
  // observer builds it once the container gets a size.
  if (!hasSize()) {
    return;
  }

  building.value = true;

  const options: PeaksOptions = {
    zoomview: { ...getZoomviewOptions(), container: zoomviewContainer.value },
    player: playerAdapter,
    keyboard: false,
    zoomLevels: [props.scale],
    waveformData: { arraybuffer: waveform.data },
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
    if (generation === buildGeneration) {
      building.value = false;
    }

    return;
  }

  peaks = instance;
  peaks.views.getView("zoomview")?.enableSeek(false);
  applyView();
  drawn.value = true;
  building.value = false;
}

// Not an immediate watcher: that would run during setup, before the container exists.
onMounted(buildPeaks);
watch(() => props.waveform, buildPeaks);
watch([() => props.scale, () => props.offset], applyView);

useResizeObserver(zoomviewContainer, () => {
  if (!peaks && props.waveform && hasSize()) {
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
    class="relative"
    :data-zoom-scale="drawn ? scale : 0"
    :data-sample-rate="waveform?.sampleRate"
  >
    <div
      ref="zoomview"
      class="pointer-events-none size-full"
      role="img"
      aria-label="Waveform"
    />
    <div
      v-if="showsSpinner"
      class="absolute inset-0 flex items-center justify-center"
    >
      <ProgressSpinner
        class="size-10"
        aria-label="Loading waveform"
      />
    </div>
  </div>
</template>
