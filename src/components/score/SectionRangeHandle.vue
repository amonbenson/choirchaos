<script setup lang="ts">
import { usePointerSwipe } from "@vueuse/core";
import { useTemplateRef } from "vue";

import type { RangeHandle } from "@/composables/useSectionRange";
import type { SectionKind } from "@/core/models/sections";

import { SECTION_COLORS } from "./sectionColors";

defineProps<{
  handle: RangeHandle;
  /** How many positions the recording has, the slider's range. */
  count: number;
  kind: SectionKind;
}>();

const emit = defineEmits<{
  /** Where the pointer is while the handle is dragged, in client coordinates. */
  drag: [point: { x: number; y: number }];
  drop: [];
}>();

const element = useTemplateRef<HTMLElement>("element");

const { posEnd } = usePointerSwipe(element, {
  threshold: 1,
  onSwipe: () => emit("drag", { x: posEnd.x, y: posEnd.y }),
  onSwipeEnd: () => emit("drop"),
});

defineExpose({
  focus: () => element.value?.focus(),
  hasFocus: () => !!element.value && document.activeElement === element.value,
});
</script>

<!--
  The handle keeps its pointer events and stops them, so the score does not pan and the timeline does not scrub
  while it moves. It also keeps its cursor while the canvas locks one (data-handle).
-->
<template>
  <div
    ref="element"
    class="pointer-events-auto absolute flex h-6 w-5 -translate-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
    role="slider"
    tabindex="0"
    aria-orientation="horizontal"
    :aria-label="handle.name"
    :aria-valuemin="1"
    :aria-valuemax="count"
    :aria-valuenow="handle.position + 1"
    :aria-valuetext="handle.valueText"
    data-handle
    @pointerdown.stop
    @click.stop
    @touchstart.stop
    @touchmove.stop
  >
    <span
      class="pointer-events-none h-4 w-2 rounded-sm ring-2 ring-primary"
      :class="SECTION_COLORS[kind].background"
    />
  </div>
</template>
