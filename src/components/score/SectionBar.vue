<script setup lang="ts">
import { computed } from "vue";

import type { SectionBar } from "@/core/models/scoreOverlays";

import ScoreBadge from "./ScoreBadge.vue";
import ScoreLane from "./ScoreLane.vue";
import { SECTION_COLORS } from "./sectionColors";

const props = defineProps<{
  bar: SectionBar;
  selected: boolean;
}>();

const emit = defineEmits<{
  select: [];
}>();

const runStyle = computed(() => ({
  left: `${props.bar.run.x * 100}%`,
  width: `${props.bar.run.width * 100}%`,
  bottom: `${(1 - props.bar.run.y) * 100}%`,
}));
</script>

<template>
  <ScoreLane
    :lane="bar.lane"
    :style="runStyle"
  >
    <ScoreBadge
      class="ml-0.5 self-start"
      :tone="bar.section.kind"
      :name="bar.name"
      selectable
      :selected="selected"
      @select="emit('select')"
    >
      {{ bar.chip }}
    </ScoreBadge>
    <template #bar>
      <div
        class="absolute inset-0 mx-0.5 rounded-full"
        :class="SECTION_COLORS[bar.section.kind].background"
      />
    </template>
  </ScoreLane>
</template>
