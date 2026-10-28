<script setup lang="ts">
import { computed, useTemplateRef } from "vue";

import { SECTION_COLORS } from "@/components/score/sectionColors";
import SectionRangeHandle from "@/components/score/SectionRangeHandle.vue";
import { type RangeEnd, type RangeHandle, useSectionRange } from "@/composables/useSectionRange";
import type { TimelineAxis } from "@/composables/useTimelineAxis";
import { replaceSections, type Section } from "@/core/models/sections";
import type Song from "@/core/models/song";
import { getSectionTicks } from "@/core/player/route";
import { findPositionAt, getBeatTick, getStartTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{
  song: Song;
  section: Section;
  axis: TimelineAxis;
}>();

const player = usePlayerStore();
const range = useSectionRange(() => props.song, () => props.section);
const element = useTemplateRef<HTMLElement>("element");

type PlacedHandle = RangeHandle & { x: number };

const handles = computed<PlacedHandle[]>(() => {
  const shown = range.shownSection.value;
  return range.handles.value.flatMap((handle) => {
    const position = player.timeline[handle.position];
    const tick = position && (handle.end === "first" ? getBeatTick(position, shown.from.beat) : getBeatTick(position, shown.to.beat + 1));
    return tick !== undefined && props.axis.isVisible(tick) ? [{ ...handle, x: props.axis.toX(tick) }] : [];
  });
});

/** Where the section would lie with all its recorded passes, shaded while a handle is dragged. */
const preview = computed(() => {
  if (!range.dragged.value) {
    return undefined;
  }

  const sections = replaceSections(props.song.getSections(), [props.section], range.shownSection.value);
  const ticks = getSectionTicks(player.timeline, sections, range.shownSection.value);
  return ticks && props.axis.toBlock(ticks.start, ticks.end);
});

/** The measure boundary in playing order nearest to the pointer. A first handle starts the measure after it, a last one ends the measure before it. */
function onDrag(end: RangeEnd, { x }: { x: number }): void {
  const left = element.value?.getBoundingClientRect().left ?? 0;
  const tick = props.axis.toTick(x - left);
  const position = findPositionAt(player.timeline, tick);
  if (!position) {
    return;
  }

  const boundary = tick - getStartTick(position) < position.endTick - tick ? position.position : position.position + 1;
  range.dragTo(end, end === "first" ? boundary : boundary - 1);
}
</script>

<template>
  <div
    ref="element"
    class="pointer-events-none absolute inset-0"
  >
    <div
      v-if="preview"
      class="absolute inset-y-0 rounded-sm opacity-30"
      :class="SECTION_COLORS[section.kind].background"
      :style="{ left: `${preview.left}px`, width: `${preview.width}px` }"
      aria-hidden="true"
    />
    <SectionRangeHandle
      v-for="handle of handles"
      :key="handle.end"
      :ref="instance => range.setHandleElement(handle.end, instance as InstanceType<typeof SectionRangeHandle> | null)"
      class="top-1/2"
      :style="{ left: `${handle.x}px` }"
      :handle="handle"
      :count="song.getTimeline().length"
      :kind="section.kind"
      @drag="onDrag(handle.end, $event)"
      @drop="range.drop()"
      @keydown="range.onKeydown($event, handle.end)"
    />
  </div>
</template>
