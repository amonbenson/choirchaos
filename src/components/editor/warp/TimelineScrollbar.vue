<script setup lang="ts">
import { useElementSize, usePointerSwipe } from "@vueuse/core";
import { computed, useTemplateRef } from "vue";

import type { TimelineAxis } from "@/composables/useTimelineAxis";

const props = defineProps<{ axis: TimelineAxis }>();

// Keeps the thumb easy to grab when the song is much longer than the view.
const MIN_THUMB_WIDTH_PX = 40;

const track = useTemplateRef<HTMLElement>("track");
const thumb = useTemplateRef<HTMLElement>("thumb");
const { width: trackWidth } = useElementSize(track);

const thumbWidth = computed(() => {
  const { width, contentWidth } = props.axis;
  return Math.max(MIN_THUMB_WIDTH_PX, (trackWidth.value * width.value) / Math.max(1, contentWidth.value));
});
// Content pixels per pixel of thumb travel.
const ratio = computed(() => {
  const { width, contentWidth } = props.axis;
  const travel = trackWidth.value - thumbWidth.value;
  return travel > 0 ? (contentWidth.value - width.value) / travel : 0;
});
const thumbLeft = computed(() => (ratio.value ? props.axis.offset.value / ratio.value : 0));

let startOffset = 0;

// A browser scrollbar cannot carry a song zoomed to single samples, which is wider than any element may be.
const { posStart } = usePointerSwipe(thumb, {
  threshold: 0,
  disableTextSelect: true,
  onSwipeStart: () => {
    startOffset = props.axis.offset.value;
  },
  onSwipe: (event) => {
    props.axis.scrollTo(startOffset + (event.clientX - posStart.x) * ratio.value);
  },
});

/** A press on the track beside the thumb centers the thumb there. */
function onTrackDown(event: PointerEvent): void {
  if (event.target === thumb.value) {
    return;
  }

  const x = event.clientX - track.value!.getBoundingClientRect().left - thumbWidth.value / 2;
  props.axis.scrollTo(x * ratio.value);
}
</script>

<template>
  <div
    ref="track"
    class="relative h-3 flex-none rounded-full bg-surface-100 dark:bg-surface-800"
    aria-hidden="true"
    @pointerdown="onTrackDown"
  >
    <div
      ref="thumb"
      class="absolute inset-y-0 rounded-full bg-surface-300 hover:bg-surface-400 dark:bg-surface-600 dark:hover:bg-surface-500"
      :style="{ left: `${thumbLeft}px`, width: `${thumbWidth}px` }"
    />
  </div>
</template>
