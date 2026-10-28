<script setup lang="ts">
import type { AxisBlock } from "@/composables/useTimelineAxis";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  /** Where the item lies on the axis. Items at a single tick have no width and size to their text. */
  block: Pick<AxisBlock, "left"> & Partial<Pick<AxisBlock, "width">>;
  name: string;
  /** Whether the item's object is selected. Undefined for items that only move the playhead. */
  pressed?: boolean;
}>();

// Narrower items hide their text instead of showing a clipped first letter.
const MIN_TEXT_WIDTH_PX = 18;

const hasText = (): boolean => props.block.width === undefined || props.block.width >= MIN_TEXT_WIDTH_PX;
</script>

<template>
  <li
    class="absolute inset-y-0"
    :class="block.width === undefined ? 'max-w-28' : ''"
    :style="{ left: `${block.left}px`, width: block.width === undefined ? undefined : `${block.width}px` }"
  >
    <button
      v-bind="$attrs"
      type="button"
      class="flex size-full items-center gap-1 truncate rounded-sm px-1 whitespace-nowrap focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      :class="pressed ? 'ring-2 ring-primary ring-inset' : ''"
      :aria-label="name"
      :aria-pressed="pressed"
    >
      <slot v-if="hasText()" />
    </button>
  </li>
</template>
