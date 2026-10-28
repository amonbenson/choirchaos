<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useSyncEditor } from "@/composables/useSyncEditor";
import { formatLocation, formatSyncPlace } from "@/core/models/locationFormat";
import type { RecordedPass, TimelineEntry } from "@/core/models/recording";
import type Song from "@/core/models/song";
import { canPlaceWarpMarker, formatSyncTime, getSyncPlaceKey, RECORDING_END, type SyncPlace } from "@/core/models/warpEditing";
import { getStartTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";

import InspectorSection from "./InspectorSection.vue";

const MILLISECONDS_PER_SECOND = 1000;

const props = defineProps<{
  song: Song;
  run: RecordedPass;
}>();

const player = usePlayerStore();
const selection = injectEditorSelection();
const sync = useSyncEditor(() => props.song);

type SyncRow = {
  place: SyncPlace;
  /** "12, 2nd time" or "the end of 32", for hints and labels. */
  name: string;
  missing: string;
  estimate?: string;
  syncLabel: string;
  syncedLabel: string;
  time?: number;
  canSyncToPlayhead: boolean;
};

function toSeconds(tick: number): number {
  return tick / MILLISECONDS_PER_SECOND;
}

function canSyncToPlayhead(place: SyncPlace): boolean {
  return player.ready && canPlaceWarpMarker(props.song.getTimeline(), props.song.getSyncPoints(), place, sync.getPlayheadTime(), sync.getDuration());
}

function getStartRow(entry: TimelineEntry): SyncRow {
  const place = { measure: entry.measure, occurrence: entry.occurrence };
  const name = formatLocation(props.song, place);
  const timed = player.timeline[entry.position];
  return {
    place,
    name,
    missing: "No sync point.",
    estimate: timed && `${name} starts at about ${formatSyncTime(toSeconds(getStartTick(timed)))}`,
    syncLabel: "Sync to playhead",
    syncedLabel: "Sync point",
    time: sync.getTime(place),
    canSyncToPlayhead: canSyncToPlayhead(place),
  };
}

function getEndRow(entry: TimelineEntry): SyncRow {
  const timed = player.timeline[entry.position];
  return {
    place: RECORDING_END,
    name: formatSyncPlace(props.song, RECORDING_END),
    missing: "The end of the recording has no sync point.",
    estimate: timed && `${formatLocation(props.song, entry)} ends at about ${formatSyncTime(toSeconds(timed.endTick))}`,
    syncLabel: "Sync end to playhead",
    syncedLabel: "End sync point",
    time: sync.getTime(RECORDING_END),
    canSyncToPlayhead: canSyncToPlayhead(RECORDING_END),
  };
}

/** The sync point belongs to the selected pass, which is where its first measure plays. A pass ending the recording can also sync its end. */
const rows = computed(() => {
  const timeline = props.song.getTimeline();
  const start = getStartRow(timeline[props.run.first]!);
  return props.run.last === timeline.length - 1 ? [start, getEndRow(timeline[props.run.last]!)] : [start];
});

/** Adds the sync point and selects it, where it can be nudged. */
async function syncToPlayhead(place: SyncPlace): Promise<void> {
  await sync.syncToPlayhead(place);
  selection.select({ kind: "syncPoint", place });
}
</script>

<template>
  <InspectorSection title="Audio sync">
    <div
      v-for="row in rows"
      :key="getSyncPlaceKey(row.place)"
      class="flex flex-col gap-2"
    >
      <Button
        v-if="row.time !== undefined"
        :label="`${row.syncedLabel} at ${formatSyncTime(row.time)}`"
        icon="pi pi-map-marker"
        severity="secondary"
        size="small"
        class="self-start"
        :aria-label="`Select sync point at ${row.name}`"
        @click="selection.select({ kind: 'syncPoint', place: row.place })"
      />

      <template v-else>
        <span class="text-sm">
          {{ row.missing }}<template v-if="row.estimate"> {{ row.estimate }}, following the sync points around it.</template>
        </span>
        <Button
          :label="row.syncLabel"
          icon="pi pi-map-marker"
          severity="secondary"
          size="small"
          class="self-start"
          :disabled="!row.canSyncToPlayhead"
          @click="syncToPlayhead(row.place)"
        />
        <span
          v-if="player.ready && !row.canSyncToPlayhead"
          class="text-xs text-muted-color"
        >To sync {{ row.name }}, move the playhead between the sync points before and after it.</span>
      </template>
    </div>
  </InspectorSection>
</template>
