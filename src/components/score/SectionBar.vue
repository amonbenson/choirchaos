<script setup lang="ts">
import { computed } from "vue";

import { BAR_GAP_PX, BAR_HEIGHT_PX, getLaneOffset, type SectionBar } from "@/core/models/scoreOverlays";

import ScoreBadge from "./ScoreBadge.vue";
import { SECTION_COLORS } from "./sectionColors";

const props = defineProps<{
  bar: SectionBar;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

/** A line without height above the run, at the bottom of the bar's lane. The chip sits on it and the bar hangs below it. */
const laneStyle = computed(() => ({
  left: `${props.bar.run.x * 100}%`,
  width: `${props.bar.run.width * 100}%`,
  top: `calc(${props.bar.run.y * 100}% - ${getLaneOffset(props.bar.lane)}px)`,
}));

const barStyle = { top: `${BAR_GAP_PX}px`, height: `${BAR_HEIGHT_PX}px` };
</script>

<template>
  <div
    class="pointer-events-none absolute h-0"
    :style="laneStyle"
  >
    <div
      class="absolute inset-x-0 rounded-full"
      :class="SECTION_COLORS[bar.section.kind].background"
      :style="barStyle"
    />
    <ScoreBadge
      class="absolute bottom-0 left-0.5"
      :tone="bar.section.kind"
      :name="bar.name"
      selectable
      :selected="selected"
      @select="emit('select')"
    >
      {{ bar.chip }}
    </ScoreBadge>
  </div>
</template>
