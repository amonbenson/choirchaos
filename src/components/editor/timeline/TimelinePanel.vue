<script setup lang="ts">
import { useMediaQuery, usePointerSwipe } from "@vueuse/core";
import Button from "primevue/button";
import ContextMenu from "primevue/contextmenu";
import type { MenuItem } from "primevue/menuitem";
import Popover from "primevue/popover";
import Select from "primevue/select";
import { computed, ref, shallowRef, useId, useTemplateRef, watch } from "vue";

import CollapsiblePanel from "@/components/base/CollapsiblePanel.vue";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useSyncEditor } from "@/composables/useSyncEditor";
import { useTimelineAxis } from "@/composables/useTimelineAxis";
import { formatOccurrence, formatSyncPlace } from "@/core/models/locationFormat";
import type Song from "@/core/models/song";
import {
  constrainWarpMarkerTime,
  getPositionedSyncPoints,
  getSyncPlaceKey,
  getWarpMarkerCandidates,
  isRecordingEnd,
  type PositionedSyncPoint,
  type SyncPlace,
} from "@/core/models/warpEditing";
import { mixdownChunks } from "@/core/player/audio/mixdown";
import { upperFirst } from "@/core/utils/text";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import { SYNC_POINT_COLORS } from "./syncColors";
import TimelineLanes, { type LaneName } from "./TimelineLanes.vue";
import TimelineMeasureRuler from "./TimelineMeasureRuler.vue";
import TimelineScrollbar from "./TimelineScrollbar.vue";
import TimelineTimeRuler from "./TimelineTimeRuler.vue";
import WaveformView, { getWaveformBaseScale } from "./WaveformView.vue";

const props = defineProps<{ song: Song }>();

// Audio mode ticks are milliseconds, sync points are stored in seconds.
const MILLISECONDS_PER_SECOND = 1000;
// A press that moves less than this is a click, which selects or seeks instead of scrubbing.
const DRAG_THRESHOLD_PX = 4;
// Sync points are thin lines, so they take presses a few pixels to either side.
const SYNC_POINT_HIT_PX = 10;
const LANES: LaneName[] = ["Markers", "Sections", "Recording", "Measures"];

const player = usePlayerStore();
const settings = useSettingsStore();
const { selectAndSeek, clear } = injectEditorSelection();
const sync = useSyncEditor(() => props.song);
const titleId = useId();
const laneIdPrefix = useId();
const laneTitleIds = Object.fromEntries(LANES.map(lane => [lane, `${laneIdPrefix}-${lane}`])) as Record<LaneName, string>;

// Below lg the timeline is a tab of its own, so it is always open there.
const isDesktop = useMediaQuery("(min-width: 64rem)");
const collapsed = computed(() => isDesktop.value && !settings.current.workspace.panelVisible.timeline);
const isAudio = computed(() => props.song.playerMode === "audio");
const rootClass = computed(() => {
  if (!isDesktop.value) {
    return "flex h-full flex-col overflow-hidden";
  }

  return !collapsed.value && isAudio.value ? "flex h-72 flex-col overflow-hidden" : "flex flex-col overflow-hidden";
});

const axisElement = useTemplateRef<HTMLElement>("axisElement");
const audioArea = useTemplateRef<HTMLElement>("audioArea");
const markerMenu = ref();
const markerMenuItems = ref<MenuItem[]>([]);
const addPopover = ref();
const audioBuffer = shallowRef<AudioBuffer>();
const dragged = shallowRef<{ id: string; time: number }>();
const pointsAtSyncPoint = ref(false);

// Audio songs zoom in whole samples of the recording, MIDI songs in ticks.
const axis = useTimelineAxis(axisElement, {
  duration: () => player.duration,
  ticksPerUnit: () => audioBuffer.value ? MILLISECONDS_PER_SECOND / audioBuffer.value.sampleRate : 1,
  minScale: () => audioBuffer.value ? getWaveformBaseScale(audioBuffer.value) : 1,
});

const currentTime = computed(() => player.position / MILLISECONDS_PER_SECOND);
const duration = computed(() => player.duration / MILLISECONDS_PER_SECOND);
const playheadX = computed(() => player.ready && axis.isVisible(player.position) ? Math.round(axis.toX(player.position)) : undefined);

const positionedMarkers = computed(() => getPositionedSyncPoints(player.timeline, props.song.getSyncPoints()));
const markersByKey = computed(() => new Map(positionedMarkers.value.map(marker => [getSyncPlaceKey(marker.place), marker])));

const markers = computed(() => positionedMarkers.value.map((marker) => {
  const id = getSyncPlaceKey(marker.place);
  return {
    id,
    time: dragged.value?.id === id ? dragged.value.time : sync.getTime(marker.place) ?? marker.time,
  };
}));

const syncLines = computed(() => markers.value.flatMap(({ id, time }) => {
  const tick = time * MILLISECONDS_PER_SECOND;
  return axis.isVisible(tick) ? [{ id, x: Math.round(axis.toX(tick)) }] : [];
}));

const candidates = computed(() => getWarpMarkerCandidates(player.timeline, props.song.getSyncPoints(), currentTime.value, duration.value));

const candidateOptions = computed(() => candidates.value.map(candidate => ({
  label: upperFirst(getLabel(candidate)),
  value: getSyncPlaceKey(candidate),
})));

const candidateQuestion = computed(() => candidates.value.some(isRecordingEnd) ? "Which measure starts or ends here?" : "Which measure starts here?");

function getLabel(place: SyncPlace): string {
  if (isRecordingEnd(place)) {
    return formatSyncPlace(props.song, place);
  }

  return formatOccurrence(props.song.findMeasure(place.measure)?.label ?? place.measure, place.occurrence);
}

watch(() => [player.status, props.song] as const, ([status, song]) => {
  audioBuffer.value = status === "ready" && song.playerMode === "audio"
    ? mixdownChunks(player.player.getTrackChunks())
    : undefined;
  axis.fit();
}, { immediate: true });

async function addMarker(key: string): Promise<void> {
  addPopover.value?.hide();
  const candidate = candidates.value.find(place => getSyncPlaceKey(place) === key);
  if (candidate) {
    await sync.add(candidate, currentTime.value);
    selectSyncPoint(candidate);
  }
}

function onAddClick(event: Event): void {
  const [only, ...others] = candidates.value;
  if (only && others.length === 0) {
    addMarker(getSyncPlaceKey(only));
  } else {
    addPopover.value.toggle(event);
  }
}

function selectSyncPoint(place: SyncPlace): void {
  selectAndSeek({ kind: "syncPoint", place: isRecordingEnd(place) ? place : { measure: place.measure, occurrence: place.occurrence } });
}

function openMarkerMenu(marker: PositionedSyncPoint, event: MouseEvent): void {
  markerMenuItems.value = [
    { label: `Sync point at ${getLabel(marker.place)}`, disabled: true },
    { label: "Remove sync point", icon: "pi pi-trash", command: () => sync.remove(marker.place) },
  ];
  markerMenu.value.show(event);
}

function toAxisX(event: MouseEvent): number {
  return event.clientX - axisElement.value!.getBoundingClientRect().left;
}

function seekTo(event: MouseEvent): void {
  player.seek(Math.min(player.duration, Math.max(0, axis.toTick(toAxisX(event)))));
}

function isOnAudio(event: MouseEvent): boolean {
  return event.target instanceof Node && !!audioArea.value?.contains(event.target);
}

/** The sync point drawn under the pointer. Sync points only take presses below the measure ruler. */
function findSyncPointAt(event: MouseEvent): PositionedSyncPoint | undefined {
  if (!isOnAudio(event)) {
    return undefined;
  }

  const x = toAxisX(event);
  const distanceTo = (marker: { time: number }): number => Math.abs(axis.toX(marker.time * MILLISECONDS_PER_SECOND) - x);
  const [nearest] = markers.value.filter(marker => distanceTo(marker) <= SYNC_POINT_HIT_PX).sort((a, b) => distanceTo(a) - distanceTo(b));
  return nearest && markersByKey.value.get(nearest.id);
}

// One handler for the whole axis: a drag moves the sync point it starts on and scrubs the playhead
// anywhere else. peaks.js has no option to scrub by dragging, its own drag scrolls the waveform.
let drag: { marker: PositionedSyncPoint; startX: number; startTime: number } | undefined;
let swallowClick = false;

const { isSwiping } = usePointerSwipe(axisElement, {
  threshold: DRAG_THRESHOLD_PX,
  disableTextSelect: true,
  onSwipeStart: (event) => {
    swallowClick = false;
    const marker = findSyncPointAt(event);
    drag = marker && { marker, startX: toAxisX(event), startTime: sync.getTime(marker.place) ?? marker.time };
  },
  onSwipe: (event) => {
    if (!drag) {
      seekTo(event);
      return;
    }

    const delta = (axis.toTick(toAxisX(event)) - axis.toTick(drag.startX)) / MILLISECONDS_PER_SECOND;
    const time = constrainWarpMarkerTime(player.timeline, props.song.getSyncPoints(), drag.marker.place, drag.startTime + delta, duration.value);
    dragged.value = { id: getSyncPlaceKey(drag.marker.place), time };
  },
  onSwipeEnd: () => {
    swallowClick = true;
    if (drag && dragged.value) {
      sync.moveTo(drag.marker.place, dragged.value.time);
    }

    drag = undefined;
    dragged.value = undefined;
  },
});

/** The click that ends a drag neither selects nor seeks. */
function onClickCapture(event: MouseEvent): void {
  if (swallowClick) {
    swallowClick = false;
    event.stopImmediatePropagation();
  }
}

/**
 * A click on empty lane space clears the selection and moves the playhead there. The waveform only moves
 * the playhead, so a selected measure can be synced to where it really starts.
 */
function onClick(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest("button")) {
    return;
  }

  const marker = findSyncPointAt(event);
  if (marker) {
    selectSyncPoint(marker.place);
    return;
  }

  if (!isOnAudio(event)) {
    clear();
  }

  seekTo(event);
}

function onContextMenu(event: MouseEvent): void {
  const marker = findSyncPointAt(event);
  if (marker) {
    event.preventDefault();
    openMarkerMenu(marker, event);
  }
}

watch(() => player.position, (tick) => {
  if (!isSwiping.value) {
    axis.reveal(tick);
  }
});
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
    @update:collapsed="settings.togglePanelVisible('timeline')"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        <span
          :id="titleId"
          class="font-bold"
        >Timeline</span>
        <!-- <span
          v-if="!collapsed"
          class="hidden flex-1 truncate text-sm text-muted-color md:inline"
        >{{ isAudio
          ? "Drag to move the playhead. Pause where a measure starts to add a sync point, or drag one to move it. Hold Ctrl and scroll to zoom."
          : "The measures in the order the recording plays them. Drag to move the playhead, hold Ctrl and scroll to zoom." }}</span> -->
        <div
          v-if="!collapsed"
          class="ml-auto flex items-center gap-1"
        >
          <Button
            v-if="isAudio"
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
            @click="axis.zoomOut()"
          />
          <Button
            v-tooltip.top="'Zoom in'"
            icon="pi pi-search-plus"
            size="small"
            severity="secondary"
            aria-label="Zoom in"
            text
            rounded
            @click="axis.zoomIn()"
          />
          <Button
            v-tooltip.top="'Show whole song'"
            icon="pi pi-arrows-h"
            size="small"
            severity="secondary"
            aria-label="Fit to view"
            text
            rounded
            @click="axis.fit()"
          />
        </div>
      </div>
    </template>

    <div
      role="region"
      :aria-labelledby="titleId"
      class="flex h-full min-w-0 gap-2 text-xs"
    >
      <div class="flex w-16 flex-none flex-col gap-1 text-muted-color">
        <span
          v-for="lane in LANES"
          :id="laneTitleIds[lane]"
          :key="lane"
          class="flex h-6 items-center"
        >{{ lane }}</span>
      </div>

      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div
          ref="axisElement"
          class="relative flex min-h-0 flex-col gap-1 overflow-hidden"
          :class="[isAudio ? 'flex-1' : '', pointsAtSyncPoint ? 'cursor-ew-resize' : '']"
          @click.capture="onClickCapture"
          @click="onClick"
          @contextmenu="onContextMenu"
          @pointermove="pointsAtSyncPoint = !!findSyncPointAt($event)"
          @pointerleave="pointsAtSyncPoint = false"
        >
          <TimelineLanes
            :song="song"
            :axis="axis"
            :title-ids="laneTitleIds"
          />
          <div
            class="relative flex flex-col overflow-hidden rounded bg-surface-100 dark:bg-surface-900"
            :class="isAudio ? 'min-h-0 flex-1' : ''"
          >
            <TimelineMeasureRuler
              :song="song"
              :axis="axis"
              :title-id="laneTitleIds.Measures"
            />
            <div
              v-if="isAudio"
              ref="audioArea"
              class="flex min-h-24 flex-1 flex-col"
            >
              <WaveformView
                class="min-h-0 flex-1"
                :audio-buffer="audioBuffer"
                :scale="axis.scale.value"
                :offset="axis.offset.value"
              />
              <TimelineTimeRuler
                :axis="axis"
                :ticks-per-second="MILLISECONDS_PER_SECOND"
              />
            </div>
            <div
              v-for="line in syncLines"
              :key="line.id"
              class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2"
              :class="SYNC_POINT_COLORS.line"
              :style="{ left: `${line.x}px` }"
              aria-hidden="true"
            />
          </div>
          <div
            v-if="playheadX !== undefined"
            class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
            :style="{ left: `${playheadX}px` }"
            aria-hidden="true"
          />
        </div>
        <TimelineScrollbar :axis="axis" />
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
        >{{ candidateQuestion }}</label>
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
