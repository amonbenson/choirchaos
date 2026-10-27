<script setup lang="ts">
import { computed } from "vue";

import type { MeasureLayout } from "@/core/models/measure";

const props = defineProps<{
  layout: MeasureLayout;
}>();

defineSlots<{
  "default"?: () => unknown;
  "top-start"?: () => unknown;
  "top-end"?: () => unknown;
  "bottom-start"?: () => unknown;
  /** Badges here stack upwards from the corner. */
  "bottom-end"?: () => unknown;
}>();

const style = computed(() => ({
  left: `${props.layout.x * 100}%`,
  top: `${props.layout.y * 100}%`,
  width: `${props.layout.width * 100}%`,
  height: `${props.layout.height * 100}%`,
}));
</script>

<!--
  A box on the score page, positioned by its layout in page fractions. Its badges sit in the corners at
  one shared inset. State styles use outlines, which never change the box's size, so badges never move.
  The frame itself takes no pointer events. Only its surface and badges do.
-->
<template>
  <div
    class="pointer-events-none absolute"
    :style="style"
  >
    <slot />
    <div
      v-if="$slots['top-start']"
      class="absolute top-0.5 left-0.5 flex gap-0.5"
    >
      <slot name="top-start" />
    </div>
    <div
      v-if="$slots['top-end']"
      class="absolute top-0.5 right-0.5 flex gap-0.5"
    >
      <slot name="top-end" />
    </div>
    <div
      v-if="$slots['bottom-start']"
      class="absolute bottom-0.5 left-0.5 flex gap-0.5"
    >
      <slot name="bottom-start" />
    </div>
    <div
      v-if="$slots['bottom-end']"
      class="absolute right-0.5 bottom-0.5 flex flex-col-reverse items-end gap-0.5"
    >
      <slot name="bottom-end" />
    </div>
  </div>
</template>
