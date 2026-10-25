<script setup lang="ts">
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import type { MenuItem } from "primevue/menuitem";
import Popover from "primevue/popover";
import Select from "primevue/select";
import { computed, ref, shallowRef, useTemplateRef, watch } from "vue";

import CollapsiblePanel from "@/components/base/CollapsiblePanel.vue";
import { formatOccurrence, formatOccurrenceShort } from "@/core/models/locationFormat";
import type { Occurrence } from "@/core/models/recording";
import type Song from "@/core/models/song";
import {
  constrainWarpMarkerTime,
  getOccurrenceKey,
  getPositionedWarpMarkers,
  getWarpMarkerCandidates,
} from "@/core/models/warpEditing";
import { mixdownChunks } from "@/core/player/audio/mixdown";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import WaveformView, { type WaveformMarker } from "./WaveformView.vue";

const props = defineProps<{ song: Song | undefined }>();

const player = usePlayerStore();
const settings = useSettingsStore();
const collapsed = computed(() => !settings.current.workspace.panelVisible.warp);

const waveform = useTemplateRef<InstanceType<typeof WaveformView>>("waveform");
const markerMenu = ref();
const markerMenuItems = ref<MenuItem[]>([]);
const addPopover = ref();
const audioBuffer = shallowRef<AudioBuffer>();

// Audio mode positions are milliseconds.
const currentTime = computed(() => player.position / 1000);
const duration = computed(() => player.duration / 1000);

const positionedMarkers = computed(() => getPositionedWarpMarkers(player.timeline, props.song?.getWarpMarkers() ?? []));
const markersByKey = computed(() => new Map(positionedMarkers.value.map(marker => [getOccurrenceKey(marker), marker])));

const markers = computed<WaveformMarker[]>(() => positionedMarkers.value.map(marker => ({
  id: getOccurrenceKey(marker),
  time: marker.time,
  label: formatOccurrenceShort(getLabel(marker), marker.occurrence),
})));

const candidates = computed(() => props.song
  ? getWarpMarkerCandidates(player.timeline, props.song.getWarpMarkers(), currentTime.value, duration.value)
  : []);

const candidateOptions = computed(() => candidates.value.map(candidate => ({
  label: formatOccurrence(getLabel(candidate), candidate.occurrence),
  value: getOccurrenceKey(candidate),
})));

function getLabel({ measure }: Occurrence): string {
  return props.song?.findMeasure(measure)?.label ?? measure;
}

function describeMarker(occurrence: Occurrence): string {
  return `Measure ${formatOccurrence(getLabel(occurrence), occurrence.occurrence)}`;
}

watch(() => [player.status, props.song] as const, ([status, song]) => {
  audioBuffer.value = status === "ready" && song?.playerMode === "audio"
    ? mixdownChunks(player.player.getTrackChunks())
    : undefined;
}, { immediate: true });

async function moveMarker(key: string, time: number): Promise<void> {
  const marker = markersByKey.value.get(key);
  if (!marker) {
    return;
  }

  await props.song?.moveWarpMarker(marker, time);
  player.syncWarp();
}

async function deleteMarker(occurrence: Occurrence): Promise<void> {
  await props.song?.removeWarpMarker(occurrence);
  player.syncWarp();
}

async function addMarker(key: string): Promise<void> {
  addPopover.value?.hide();
  const candidate = candidates.value.find(entry => getOccurrenceKey(entry) === key);
  if (!candidate) {
    return;
  }

  await props.song?.addWarpMarker({ measure: candidate.measure, occurrence: candidate.occurrence, time: currentTime.value });
  player.syncWarp();
}

function onAddClick(event: Event): void {
  const [only, ...others] = candidates.value;
  if (only && others.length === 0) {
    addMarker(getOccurrenceKey(only));
  } else {
    addPopover.value.toggle(event);
  }
}

function openMarkerMenu(key: string, event: MouseEvent): void {
  const marker = markersByKey.value.get(key);
  if (!marker) {
    return;
  }

  markerMenuItems.value = [
    { label: describeMarker(marker), disabled: true },
    { label: "Delete marker", icon: "pi pi-trash", command: () => deleteMarker(marker) },
  ];
  markerMenu.value.show(event);
}

function constrainMarker(key: string, time: number): number {
  const marker = markersByKey.value.get(key);
  if (!props.song || !marker) {
    return time;
  }

  return constrainWarpMarkerTime(player.timeline, props.song.getWarpMarkers(), marker, time, duration.value);
}
</script>

<template>
  <CollapsiblePanel
    :collapsed="collapsed"
    toggleable
    toggle-label="audio synchronization"
    :pt:root="collapsed ? 'flex flex-col overflow-hidden' : 'flex h-44 flex-col overflow-hidden lg:h-56'"
    pt:content-container="flex-1 min-h-0 overflow-hidden"
    pt:content-wrapper="h-full"
    pt:content="h-full pt-0 pb-2"
    @update:collapsed="settings.togglePanelVisible('warp')"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span class="font-bold">Audio Synchronization</span>
        <span
          v-if="!collapsed"
          class="hidden flex-1 truncate text-sm text-muted-color md:inline"
        >
          Place a marker on the first beat of a measure, then drag it until it lines up with the recording. Hold Ctrl and scroll to zoom.
        </span>
        <div
          v-if="!collapsed"
          class="ml-auto flex items-center gap-1"
        >
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
          :options="candidateOptions"
          option-label="label"
          option-value="value"
          aria-labelledby="warp-marker-measure"
          placeholder="Choose a measure"
          size="small"
          scroll-height="16rem"
          filter
          @update:model-value="addMarker"
        />
      </div>
    </Popover>
  </CollapsiblePanel>
</template>
