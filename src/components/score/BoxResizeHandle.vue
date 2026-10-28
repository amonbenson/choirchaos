<script setup lang="ts">
import { usePointerSwipe } from "@vueuse/core";
import { useTemplateRef } from "vue";

import type { BoxEdge } from "@/core/models/measureEditing";

const props = defineProps<{
  edge: BoxEdge;
}>();

const emit = defineEmits<{
  /** The distance dragged since the drag started, in fractions of the page. */
  move: [delta: { x: number; y: number }];
  end: [];
}>();

const PLACEMENT: Record<BoxEdge, string> = {
  top: "top-0 left-1/2 cursor-ns-resize",
  right: "top-1/2 left-full cursor-ew-resize",
  bottom: "top-full left-1/2 cursor-ns-resize",
  left: "top-1/2 left-0 cursor-ew-resize",
};

const handle = useTemplateRef<HTMLElement>("handle");

const { posStart, posEnd } = usePointerSwipe(handle, {
  threshold: 1,
  onSwipe: () => emit("move", getDelta()),
  onSwipeEnd: () => emit("end"),
});

function getDelta(): { x: number; y: number } {
  const page = handle.value?.closest<HTMLElement>("[data-page]");
  if (!page?.clientWidth || !page.clientHeight) {
    return { x: 0, y: 0 };
  }

  return { x: (posEnd.x - posStart.x) / page.clientWidth, y: (posEnd.y - posStart.y) / page.clientHeight };
}
</script>

<!-- The handle keeps its pointer events, so the score does not pan or select while it moves, and its cursor (data-handle). -->
<template>
  <div
    ref="handle"
    class="pointer-events-auto absolute flex size-5 -translate-1/2 touch-none items-center justify-center"
    :class="PLACEMENT[props.edge]"
    aria-hidden="true"
    data-handle
    @pointerdown.stop
    @click.stop
    @touchstart.stop
    @touchmove.stop
  >
    <span class="pointer-events-none size-2.5 rounded-full bg-primary ring-2 ring-surface-0 dark:ring-surface-900" />
  </div>
</template>
