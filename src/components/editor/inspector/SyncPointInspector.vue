<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { computed, ref, useId, watch } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useSyncEditor } from "@/composables/useSyncEditor";
import { formatLocation, formatOccurrence } from "@/core/models/locationFormat";
import type { Occurrence, StoredWarpMarker, TimelineEntry } from "@/core/models/recording";
import type Song from "@/core/models/song";
import {
  canPlaceWarpMarker,
  constrainWarpMarkerTime,
  formatSyncTime,
  getOccurrenceKey,
  getReassignCandidates,
  LARGE_NUDGE_STEP,
  NUDGE_STEP,
  nudgeWarpMarkerTime,
  parseSyncTime,
} from "@/core/models/warpEditing";
import { usePlayerStore } from "@/stores/player";

import RemoveButton from "./RemoveButton.vue";

const props = defineProps<{
  song: Song;
  warpMarker: StoredWarpMarker;
}>();

const player = usePlayerStore();
const selection = injectEditorSelection();
const sync = useSyncEditor(() => props.song);
const ids = { time: useId(), hint: useId(), reassign: useId(), reassignPanel: useId() };
const reassigning = ref(false);
const timeText = ref("");

const occurrence = computed<Occurrence>(() => ({ measure: props.warpMarker.measure, occurrence: props.warpMarker.occurrence }));
const place = computed(() => formatLocation(props.song, occurrence.value));
const time = computed(() => sync.getTime(occurrence.value) ?? props.warpMarker.time);

const canSyncToPlayhead = computed(() => player.ready && canPlaceWarpMarker(
  props.song.getTimeline(),
  props.song.getWarpMarkers(),
  occurrence.value,
  sync.getPlayheadTime(),
  sync.getDuration(),
));

watch(() => getOccurrenceKey(occurrence.value), () => {
  reassigning.value = false;
});

watch(time, (value) => {
  timeText.value = formatSyncTime(value);
}, { immediate: true });

function label(entry: TimelineEntry): string {
  return formatOccurrence(props.song.findMeasure(entry.measure)?.label ?? "?", entry.occurrence);
}

const reassignOptions = computed(() => getReassignCandidates(props.song.getTimeline(), props.song.getWarpMarkers(), occurrence.value, sync.getDuration())
  .map(candidate => ({ label: label(candidate), value: getOccurrenceKey(candidate), entry: candidate })));

function nudge(delta: number): void {
  sync.moveTo(occurrence.value, nudgeWarpMarkerTime(props.song.getTimeline(), props.song.getWarpMarkers(), occurrence.value, time.value, delta, sync.getDuration()));
}

function onTimeKeydown(event: KeyboardEvent): void {
  // Left and right stay with the text cursor, so the time can still be typed.
  const directions: Record<string, number> = { ArrowUp: 1, ArrowDown: -1 };
  const direction = directions[event.key];
  if (direction === undefined) {
    return;
  }

  event.preventDefault();
  nudge(direction * (event.shiftKey ? LARGE_NUDGE_STEP : NUDGE_STEP));
}

function commitTime(): void {
  const parsed = parseSyncTime(timeText.value);
  if (parsed === undefined) {
    timeText.value = formatSyncTime(time.value);
    return;
  }

  const next = constrainWarpMarkerTime(props.song.getTimeline(), props.song.getWarpMarkers(), occurrence.value, parsed, sync.getDuration());
  timeText.value = formatSyncTime(next);
  if (next !== time.value) {
    sync.moveTo(occurrence.value, next);
  }
}

/** The sync point keeps its time on the other measure, and the selection follows it there. */
async function reassign(key: string): Promise<void> {
  reassigning.value = false;
  const target = reassignOptions.value.find(option => option.value === key)?.entry;
  if (!target) {
    return;
  }

  await sync.reassign(occurrence.value, target);
  selection.selectAndSeek({ kind: "syncPoint", occurrence: { measure: target.measure, occurrence: target.occurrence } });
}

async function remove(): Promise<void> {
  if (await sync.remove(occurrence.value)) {
    selection.clear();
  }
}

defineExpose({ remove });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="flex items-center gap-2">
      <label
        :for="ids.time"
        class="text-sm"
      >Starts at</label>
      <div class="ml-auto flex items-center gap-1">
        <Button
          icon="pi pi-chevron-left"
          severity="secondary"
          size="small"
          aria-label="Nudge earlier"
          text
          rounded
          @click="nudge(-NUDGE_STEP)"
        />
        <InputText
          :id="ids.time"
          v-model="timeText"
          class="w-28 text-center font-mono"
          size="small"
          :aria-describedby="ids.hint"
          @keydown="onTimeKeydown"
          @keydown.enter="commitTime"
          @keydown.esc="timeText = formatSyncTime(time)"
          @blur="commitTime"
        />
        <Button
          icon="pi pi-chevron-right"
          severity="secondary"
          size="small"
          aria-label="Nudge later"
          text
          rounded
          @click="nudge(NUDGE_STEP)"
        />
      </div>
    </div>
    <span
      :id="ids.hint"
      class="text-xs text-muted-color"
    >The up and down arrow keys nudge by 10 ms, with Shift by 100 ms.</span>

    <div class="flex flex-wrap gap-2">
      <Button
        label="Sync to playhead"
        icon="pi pi-map-marker"
        severity="secondary"
        size="small"
        :disabled="!canSyncToPlayhead"
        @click="sync.syncToPlayhead(occurrence)"
      />
      <Button
        label="Move to another measure"
        severity="secondary"
        size="small"
        :aria-expanded="reassigning"
        :aria-controls="ids.reassignPanel"
        :disabled="reassignOptions.length === 0"
        @click="reassigning = !reassigning"
      />
    </div>
    <span
      v-if="player.ready && !canSyncToPlayhead"
      class="text-xs text-muted-color"
    >To sync {{ place }} to the playhead, move the playhead between the sync points before and after it.</span>

    <div
      v-show="reassigning"
      :id="ids.reassignPanel"
      class="flex flex-col gap-2"
    >
      <label
        :id="ids.reassign"
        class="text-sm"
      >Which measure starts at {{ formatSyncTime(time) }}?</label>
      <div class="flex items-center gap-2">
        <Select
          :options="reassignOptions"
          option-label="label"
          option-value="value"
          :aria-labelledby="ids.reassign"
          placeholder="Choose a measure"
          size="small"
          scroll-height="16rem"
          class="min-w-0 flex-1"
          filter
          @update:model-value="reassign"
        />
        <Button
          label="Cancel"
          severity="secondary"
          size="small"
          text
          @click="reassigning = false"
        />
      </div>
    </div>

    <RemoveButton
      label="Remove sync point"
      :aria-label="`Remove sync point at ${place}`"
      @click="remove"
    />
  </div>
</template>
