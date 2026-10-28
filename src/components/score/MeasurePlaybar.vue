<script setup lang="ts">
import { computed } from "vue";

import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

/** How far the playing pass has got through the measure, from 0 to 1. */
const progress = computed(() => {
  const position = player.currentTimelinePosition;
  if (!position) {
    return 0;
  }

  // Every pass of a measure moves the playbar of the same box.
  const start = position.beatTicks[0] ?? 0;
  const length = position.endTick - start;
  return length > 0 ? Math.max(0, Math.min(1, (player.position - start) / length)) : 0;
});
</script>

<template>
  <div
    class="pointer-events-none absolute top-0 h-full w-1 -translate-x-1/2 rounded-full bg-primary"
    :style="{ left: `${progress * 100}%` }"
  />
</template>
