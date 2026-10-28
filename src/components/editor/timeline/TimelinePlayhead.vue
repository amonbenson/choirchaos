<script setup lang="ts">
import { computed } from "vue";

import type { TimelineAxis } from "@/composables/useTimelineAxis";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{ axis: TimelineAxis }>();

const player = usePlayerStore();

const x = computed(() => player.ready && props.axis.isVisible(player.position) ? Math.round(props.axis.toX(player.position)) : undefined);
</script>

<template>
  <div
    v-if="x !== undefined"
    class="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-primary"
    :style="{ left: `${x}px` }"
    aria-hidden="true"
  />
</template>
