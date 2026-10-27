<script setup lang="ts">
import { usePointerSwipe } from "@vueuse/core";
import { useTemplateRef } from "vue";

const emit = defineEmits<{
  /** Where the pointer is while the handle is dragged, in client coordinates. */
  drag: [point: { x: number; y: number }];
  drop: [];
}>();

const handle = useTemplateRef<HTMLElement>("handle");

const { posEnd } = usePointerSwipe(handle, {
  threshold: 1,
  onSwipe: () => emit("drag", { x: posEnd.x, y: posEnd.y }),
  onSwipeEnd: () => emit("drop"),
});

defineExpose({
  focus: () => handle.value?.focus(),
  hasFocus: () => !!handle.value && document.activeElement === handle.value,
});
</script>

<!-- The handle keeps its pointer events, so the score does not pan or select while it moves. -->
<template>
  <div
    ref="handle"
    class="pointer-events-auto absolute flex h-6 w-5 -translate-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
    role="slider"
    tabindex="0"
    aria-orientation="horizontal"
    @pointerdown.stop
    @click.stop
    @touchstart.stop
    @touchmove.stop
  >
    <slot />
  </div>
</template>
