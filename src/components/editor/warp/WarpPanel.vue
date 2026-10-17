<script setup lang="ts">
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import type { MenuItem } from "primevue/menuitem";
import Panel from "primevue/panel";
import Popover from "primevue/popover";
import Select from "primevue/select";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";

import type Song from "@/core/models/song";
import { constrainWarpMarkerTime, getWarpMarkerCandidates } from "@/core/models/warpEditing";
import { mixdownChunks } from "@/core/player/audio/mixdown";
import type { Numbering } from "@/core/utils/numbering";
import { usePlayerStore } from "@/stores/player";

import WaveformView, { type WaveformMarker } from "./WaveformView.vue";

const props = defineProps<{ song: Song | undefined }>();

const player = usePlayerStore();

const waveform = useTemplateRef<InstanceType<typeof WaveformView>>("waveform");
const markerMenu = ref();
const markerMenuItems = ref<MenuItem[]>([]);
const addPopover = ref();
const audioBuffer = shallowRef<AudioBuffer>();

// Audio mode positions are milliseconds.
const currentTime = computed(() => player.position / 1000);
const duration = computed(() => player.duration / 1000);

const markers = computed<WaveformMarker[]>(() => (props.song?.warpMarkers ?? []).map(marker => ({
  id: marker.measure,
  time: marker.time,
  label: marker.measure,
})));

const candidates = computed(() => props.song ? getWarpMarkerCandidates(props.song, currentTime.value, duration.value) : []);

watch(() => [player.status, props.song] as const, ([status, song]) => {
  audioBuffer.value = status === "ready" && song?.playerMode === "audio"
    ? mixdownChunks(player.player.getTrackChunks())
    : undefined;
}, { immediate: true });

function reloadWarp(): void {
  const position = player.position;
  player.syncWarp();
  player.seek(position);
}

async function moveMarker(measure: Numbering, time: number): Promise<void> {
  await props.song?.setWarpMarker(measure, time);
  reloadWarp();
}

async function deleteMarker(measure: Numbering): Promise<void> {
  await props.song?.removeWarpMarker(measure);
  reloadWarp();
}

async function addMarker(measure: Numbering): Promise<void> {
  addPopover.value?.hide();
  await props.song?.addWarpMarker({ measure, time: currentTime.value });
  reloadWarp();
}

function onAddClick(event: Event): void {
  if (candidates.value.length === 1) {
    addMarker(candidates.value[0]!);
  } else {
    addPopover.value.toggle(event);
  }
}

function openMarkerMenu(measure: Numbering, event: MouseEvent): void {
  markerMenuItems.value = [
    { label: `Measure ${measure}`, disabled: true },
    { label: "Delete marker", icon: "pi pi-trash", command: () => deleteMarker(measure) },
  ];
  markerMenu.value.show(event);
}

function constrainMarker(measure: string, time: number): number {
  return props.song ? constrainWarpMarkerTime(props.song, measure, time, duration.value) : time;
}
</script>

<template>
  <Panel
    pt:root="flex h-56 flex-col overflow-hidden"
    pt:header="flex-none py-2"
    pt:content-container="flex-1 min-h-0 overflow-hidden"
    pt:content-wrapper="h-full"
    pt:content="h-full pt-0 pb-2"
  >
    <template #header>
      <div class="flex w-full flex-wrap items-center gap-x-4 gap-y-1">
        <span class="font-bold">Audio Synchronization</span>
        <span class="hidden flex-1 truncate text-sm text-muted-color md:inline">
          Place a marker on the first beat of a measure, then drag it until it lines up with the recording. Hold Ctrl and scroll to zoom.
        </span>
        <div class="ml-auto flex items-center gap-1">
          <Button
            v-tooltip.top="candidates.length === 0 ? 'Move the playhead between two markers to add one' : undefined"
            label="Add marker"
            icon="pi pi-map-marker"
            size="small"
            severity="secondary"
            :disabled="candidates.length === 0"
            @click="onAddClick"
          />
          <Button
            v-tooltip.top="'Zoom out'"
            icon="pi pi-search-minus"
            size="small"
            severity="secondary"
            aria-label="Zoom out"
            text
            rounded
            @click="waveform?.zoomOut()"
          />
          <Button
            v-tooltip.top="'Zoom in'"
            icon="pi pi-search-plus"
            size="small"
            severity="secondary"
            aria-label="Zoom in"
            text
            rounded
            @click="waveform?.zoomIn()"
          />
          <Button
            v-tooltip.top="'Show whole song'"
            icon="pi pi-arrows-h"
            size="small"
            severity="secondary"
            aria-label="Fit to view"
            text
            rounded
            @click="waveform?.fit()"
          />
        </div>
      </div>
    </template>

    <WaveformView
      ref="waveform"
      class="rounded bg-surface-100 dark:bg-surface-900"
      :audio-buffer="audioBuffer"
      :current-time="currentTime"
      :markers="markers"
      :constrain-marker="constrainMarker"
      @seek="player.seek($event * 1000)"
      @marker-move="moveMarker"
      @marker-click="openMarkerMenu"
    />

    <ContextMenu
      ref="markerMenu"
      :model="markerMenuItems"
    />

    <Popover ref="addPopover">
      <div class="flex w-56 flex-col gap-2">
        <label
          id="warp-marker-measure"
          class="text-sm font-medium"
        >Which measure starts here?</label>
        <Select
          :options="candidates"
          aria-labelledby="warp-marker-measure"
          placeholder="Choose a measure"
          size="small"
          scroll-height="16rem"
          filter
          @update:model-value="addMarker"
        />
      </div>
    </Popover>
  </Panel>
</template>
