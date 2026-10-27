<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useSyncEditor } from "@/composables/useSyncEditor";
import { formatLocation } from "@/core/models/locationFormat";
import type { Occurrence, RecordedPass } from "@/core/models/recording";
import type Song from "@/core/models/song";
import { canPlaceWarpMarker, formatSyncTime } from "@/core/models/warpEditing";
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

/** The sync point belongs to the selected pass, which is where its first measure plays. */
const occurrence = computed<Occurrence>(() => {
  const entry = props.song.getTimeline()[props.run.first]!;
  return { measure: entry.measure, occurrence: entry.occurrence };
});
const place = computed(() => formatLocation(props.song, occurrence.value));
const time = computed(() => sync.getTime(occurrence.value));

const estimatedTime = computed(() => {
  const position = player.timeline[props.run.first];
  return position && getStartTick(position) / MILLISECONDS_PER_SECOND;
});

const canSyncToPlayhead = computed(() => player.ready && canPlaceWarpMarker(
  props.song.getTimeline(),
  props.song.getWarpMarkers(),
  occurrence.value,
  sync.getPlayheadTime(),
  sync.getDuration(),
));

/** Adds the sync point and selects it, where it can be nudged. */
async function syncToPlayhead(): Promise<void> {
  const target = occurrence.value;
  await sync.syncToPlayhead(target);
  selection.select({ kind: "syncPoint", occurrence: target });
}
</script>

<template>
  <InspectorSection title="Audio sync">
    <Button
      v-if="time !== undefined"
      :label="`Sync point at ${formatSyncTime(time)}`"
      icon="pi pi-map-marker"
      severity="secondary"
      size="small"
      class="self-start"
      :aria-label="`Select sync point at ${place}`"
      @click="selection.select({ kind: 'syncPoint', occurrence })"
    />

    <template v-else>
      <span class="text-sm">
        No sync point.<template v-if="estimatedTime !== undefined"> {{ place }} starts at about {{ formatSyncTime(estimatedTime) }}, following the sync points around it.</template>
      </span>
      <Button
        label="Sync to playhead"
        icon="pi pi-map-marker"
        severity="secondary"
        size="small"
        class="self-start"
        :disabled="!canSyncToPlayhead"
        @click="syncToPlayhead"
      />
      <span
        v-if="player.ready && !canSyncToPlayhead"
        class="text-xs text-muted-color"
      >To sync {{ place }}, move the playhead between the sync points before and after it.</span>
    </template>
  </InspectorSection>
</template>
