<script setup lang="ts">
import { computed } from "vue";

import type { RulerTick } from "./rulerTicks";

const props = defineProps<{
  ticks: RulerTick[];
  /** The edge facing the waveform, which short ticks hang from. */
  edge: "top" | "bottom";
}>();

// Labels stop short of the next one, so a cramped label is cut instead of covering its neighbour.
const LABEL_GAP_PX = 4;

const items = computed(() => props.ticks.map((tick, index) => {
  const next = props.ticks.slice(index + 1).find(other => other.label !== undefined);
  return { ...tick, labelWidth: next && Math.max(0, next.x - tick.x - LABEL_GAP_PX) };
}));
</script>

<template>
  <div
    class="pointer-events-none absolute inset-0 overflow-hidden tabular-nums"
    aria-hidden="true"
  >
    <template
      v-for="tick in items"
      :key="tick.key"
    >
      <div
        class="absolute w-px bg-surface-300 dark:bg-surface-600"
        :class="[tick.label === undefined ? 'h-1.5' : 'h-full', edge === 'top' ? 'top-0' : 'bottom-0']"
        :style="{ left: `${tick.x}px` }"
      />
      <span
        v-if="tick.label !== undefined"
        class="absolute inset-y-0 flex items-center truncate pl-1"
        :class="tick.color ?? 'text-muted-color'"
        :style="{ left: `${tick.x}px`, maxWidth: tick.labelWidth === undefined ? undefined : `${tick.labelWidth}px` }"
      >{{ tick.label }}<sup v-if="tick.superscript">{{ tick.superscript }}</sup></span>
    </template>
  </div>
</template>
