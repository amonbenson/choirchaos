<script setup lang="ts">
import { computed } from "vue";

import type Song from "@/core/models/song";
import { getPositionedSyncPoints, MIN_SYNC_POINTS } from "@/core/models/warpEditing";

import InspectorSection from "./InspectorSection.vue";

const props = defineProps<{
  song: Song;
}>();

const count = computed(() => getPositionedSyncPoints(props.song.getTimeline(), props.song.getSyncPoints()).length);

const summary = computed(() => {
  if (count.value === 0) {
    return "No sync points yet";
  }

  if (count.value < MIN_SYNC_POINTS) {
    return "1 sync point, a second one completes the sync";
  }

  return `Synced with ${count.value} sync points`;
});
</script>

<template>
  <InspectorSection title="Audio sync">
    <span class="flex items-start gap-2 text-sm">
      <i
        class="pi mt-0.5"
        :class="count >= MIN_SYNC_POINTS ? 'pi-check text-primary-text' : 'pi-info-circle text-muted-color'"
        aria-hidden="true"
      />
      {{ summary }}
    </span>
    <span class="text-xs text-muted-color">Move the playhead to where a measure starts, select the measure and sync it, or add sync points in the timeline.</span>
  </InspectorSection>
</template>
