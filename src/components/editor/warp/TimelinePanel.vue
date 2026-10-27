<script setup lang="ts">
import { useMediaQuery } from "@vueuse/core";
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import type { MenuItem } from "primevue/menuitem";
import Popover from "primevue/popover";
import Select from "primevue/select";
import { computed, ref, shallowRef, useId, useTemplateRef, watch } from "vue";

import CollapsiblePanel from "@/components/base/CollapsiblePanel.vue";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useSyncEditor } from "@/composables/useSyncEditor";
import { formatOccurrence, formatOccurrenceShort } from "@/core/models/locationFormat";
import type { Occurrence } from "@/core/models/recording";
import type Song from "@/core/models/song";
import {
  constrainWarpMarkerTime,
  getOccurrenceKey,
  getPositionedWarpMarkers,
  getWarpMarkerCandidates,
  type PositionedWarpMarker,
} from "@/core/models/warpEditing";
import { mixdownChunks } from "@/core/player/audio/mixdown";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import TimelineLanes from "./TimelineLanes.vue";
import WaveformView, { type WaveformMarker } from "./WaveformView.vue";

const props = defineProps<{ song: Song }>();

const MILLISECONDS_PER_SECOND = 1000;

const player = usePlayerStore();
const settings = useSettingsStore();
const { selectAndSeek } = injectEditorSelection();
const sync = useSyncEditor(() => props.song);
const titleId = useId();

// Below lg the timeline is a tab of its own, so it is always open there.
const isDesktop = useMediaQuery("(min-width: 64rem)");
const collapsed = computed(() => isDesktop.value && !settings.current.workspace.panelVisible.warp);
const isAudio = computed(() => props.song.playerMode === "audio");
const rootClass = computed(() => {
  if (!isDesktop.value) {
    return "flex h-full flex-col overflow-hidden";
  }

  return !collapsed.value && isAudio.value ? "flex h-72 flex-col overflow-hidden" : "flex flex-col overflow-hidden";
});

const waveform = useTemplateRef<InstanceType<typeof WaveformView>>("waveform");
const markerMenu = ref();
const markerMenuItems = ref<MenuItem[]>([]);
const addPopover = ref();
const audioBuffer = shallowRef<AudioBuffer>();
const waveformView = ref<{ start: number; end: number }>();

const currentTime = computed(() => player.position / MILLISECONDS_PER_SECOND);
const duration = computed(() => player.duration / MILLISECONDS_PER_SECOND);

// The lanes follow the waveform's zoom and scroll, so both show the same stretch of the song.
const lanesView = computed(() => isAudio.value && audioBuffer.value ? waveformView.value : undefined);

const positionedMarkers = computed(() => getPositionedWarpMarkers(player.timeline, props.song.getWarpMarkers()));
const markersByKey = computed(() => new Map(positionedMarkers.value.map(marker => [getOccurrenceKey(marker), marker])));

const markers = computed<WaveformMarker[]>(() => positionedMarkers.value.map(marker => ({
  id: getOccurrenceKey(marker),
  time: marker.time,
  label: formatOccurrenceShort(getLabel(marker), marker.occurrence),
})));

const candidates = computed(() => getWarpMarkerCandidates(player.timeline, props.song.getWarpMarkers(), currentTime.value, duration.value));

const candidateOptions = computed(() => candidates.value.map(candidate => ({
  label: formatOccurrence(getLabel(candidate), candidate.occurrence),
  value: getOccurrenceKey(candidate),
})));

function getLabel({ measure }: Occurrence): string {
  return props.song.findMeasure(measure)?.label ?? measure;
}

watch(() => [player.status, props.song] as const, ([status, song]) => {
  audioBuffer.value = status === "ready" && song.playerMode === "audio"
    ? mixdownChunks(player.player.getTrackChunks())
    : undefined;
}, { immediate: true });

function onView(start: number, end: number): void {
  waveformView.value = { start: start * MILLISECONDS_PER_SECOND, end: end * MILLISECONDS_PER_SECOND };
}

function moveMarker(key: string, time: number): void {
  const marker = markersByKey.value.get(key);
  if (marker) {
    sync.moveTo(marker, time);
  }
}

async function addMarker(key: string): Promise<void> {
  addPopover.value?.hide();
  const candidate = candidates.value.find(entry => getOccurrenceKey(entry) === key);
  if (candidate) {
    await sync.add(candidate, currentTime.value);
    selectAndSeek({ kind: "syncPoint", occurrence: { measure: candidate.measure, occurrence: candidate.occurrence } });
  }
}

function onAddClick(event: Event): void {
  const [only, ...others] = candidates.value;
  if (only && others.length === 0) {
    addMarker(getOccurrenceKey(only));
  } else {
    addPopover.value.toggle(event);
  }
}

function onMarkerClick(key: string): void {
  const marker = markersByKey.value.get(key);
  if (marker) {
    selectAndSeek({ kind: "syncPoint", occurrence: { measure: marker.measure, occurrence: marker.occurrence } });
  }
}

function openMarkerMenu(key: string, event: MouseEvent): void {
  const marker = markersByKey.value.get(key);
  if (!marker) {
    return;
  }

  markerMenuItems.value = [
    { label: `Sync point at ${formatOccurrence(getLabel(marker), marker.occurrence)}`, disabled: true },
    { label: "Remove sync point", icon: "pi pi-trash", command: () => removeMarker(marker) },
  ];
  markerMenu.value.show(event);
}

function removeMarker(marker: PositionedWarpMarker): void {
  sync.remove(marker);
}

function constrainMarker(key: string, time: number): number {
  const marker = markersByKey.value.get(key);
  return marker ? constrainWarpMarkerTime(player.timeline, props.song.getWarpMarkers(), marker, time, duration.value) : time;
}
</script>

<template>
  <CollapsiblePanel
    :collapsed="collapsed"
    :toggleable="isDesktop"
    toggle-label="timeline"
    :pt:root="rootClass"
    pt:content-container="flex-1 min-h-0 overflow-hidden"
    pt:content-wrapper="h-full min-w-0"
    pt:content="h-full pt-0 pb-2"
    @update:collapsed="settings.togglePanelVisible('warp')"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span
          :id="titleId"
          class="font-bold"
        >Timeline</span>
        <span
          v-if="!collapsed"
          class="hidden flex-1 truncate text-sm text-muted-color md:inline"
        >{{ isAudio
          ? "Pause where a measure starts and add a sync point, or click one to nudge it in the editor panel. Hold Ctrl and scroll to zoom."
          : "The measures in the order the recording plays them." }}</span>
        <div
          v-if="!collapsed && isAudio"
          class="ml-auto flex items-center gap-1"
        >
          <Button
            v-tooltip.top="candidates.length === 0 ? 'Move the playhead between two sync points to add one' : undefined"
            label="Add sync point"
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

    <div
      role="region"
      :aria-labelledby="titleId"
      class="flex h-full min-w-0 flex-col gap-1"
    >
      <TimelineLanes
        :song="song"
        :view="lanesView"
      />

      <div
        v-if="isAudio"
        class="flex min-h-24 flex-1 gap-2"
      >
        <span class="w-16 flex-none pt-1 text-xs text-muted-color">Audio</span>
        <WaveformView
          ref="waveform"
          class="min-w-0 flex-1 rounded bg-surface-100 dark:bg-surface-900"
          :audio-buffer="audioBuffer"
          :current-time="currentTime"
          :markers="markers"
          :constrain-marker="constrainMarker"
          @seek="player.seek($event * MILLISECONDS_PER_SECOND)"
          @marker-move="moveMarker"
          @marker-click="onMarkerClick"
          @marker-context-menu="openMarkerMenu"
          @view="onView"
        />
      </div>
    </div>

    <ContextMenu
      ref="markerMenu"
      :model="markerMenuItems"
    />

    <Popover ref="addPopover">
      <div class="flex w-56 flex-col gap-2">
        <label
          id="sync-point-measure"
          class="text-sm font-medium"
        >Which measure starts here?</label>
        <Select
          :options="candidateOptions"
          option-label="label"
          option-value="value"
          aria-labelledby="sync-point-measure"
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
