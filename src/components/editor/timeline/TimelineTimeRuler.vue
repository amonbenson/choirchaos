<script setup lang="ts">
import { computed } from "vue";

import type { TimelineAxis } from "@/composables/useTimelineAxis";

import { formatRulerTime, getMultiplesBetween, pickRulerStep, type RulerTick, TIME_STEPS } from "./rulerTicks";
import TimelineRuler from "./TimelineRuler.vue";

const props = defineProps<{
  axis: TimelineAxis;
  /** Axis ticks per second of the recording. */
  ticksPerSecond: number;
}>();

// Room for a time like "10:30".
const MIN_LABEL_SPACING_PX = 56;

const ticks = computed<RulerTick[]>(() => {
  const { axis, ticksPerSecond } = props;
  const secondWidth = axis.toX(ticksPerSecond) - axis.toX(0);
  const step = pickRulerStep(TIME_STEPS, secondWidth, MIN_LABEL_SPACING_PX);
  const end = Math.min(axis.width.value, axis.contentWidth.value - axis.offset.value);
  const seconds = getMultiplesBetween(axis.toTick(0) / ticksPerSecond, axis.toTick(end) / ticksPerSecond, step);

  return seconds.map(second => ({
    key: second,
    x: Math.round(axis.toX(second * ticksPerSecond)),
    label: formatRulerTime(second),
  }));
});
</script>

<template>
  <div class="relative h-5 flex-none">
    <TimelineRuler
      :ticks="ticks"
      edge="top"
    />
  </div>
</template>
