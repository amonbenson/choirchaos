<script setup lang="ts">
import { computed } from "vue";

import { type RangeEnd, type RangeHandle, useSectionRange } from "@/composables/useSectionRange";
import type { MeasureId, MeasureLayout } from "@/core/models/measure";
import { findNearestPosition, type Section } from "@/core/models/sections";
import type Song from "@/core/models/song";

import type { VisiblePage } from "./PdfViewer.vue";
import ScoreBox from "./ScoreBox.vue";
import ScoreLane from "./ScoreLane.vue";
import ScorePage from "./ScorePage.vue";
import { SECTION_COLORS } from "./sectionColors";
import SectionRangeHandle from "./SectionRangeHandle.vue";

const props = defineProps<{
  song: Song;
  section: Section;
  /** The lane of the section's bar, where the handles sit. */
  lane: number;
  pages: readonly VisiblePage[];
}>();

const range = useSectionRange(() => props.song, () => props.section);

type PlacedHandle = RangeHandle & { layout: MeasureLayout };

const handles = computed<PlacedHandle[]>(() => range.handles.value.flatMap((handle) => {
  const entry = props.song.getTimeline()[handle.position];
  const layout = entry && props.song.findMeasure(entry.measure)?.layout;
  return layout ? [{ ...handle, layout }] : [];
}));

/** The boxes of the section's first pass, or of where a handle is being dragged to. */
const shadedBoxes = computed(() => {
  const run = range.shownRun.value;
  const ids = new Set(run ? props.song.getTimeline().slice(run.first, run.last + 1).map(entry => entry.measure) : []);
  return [...ids].flatMap(id => props.song.findMeasure(id)?.layout ?? []);
});

function onPage<T>(items: readonly T[], page: VisiblePage, layoutOf: (item: T) => MeasureLayout): T[] {
  return items.filter(item => layoutOf(item).page === page.pageNumber);
}

function handleStyle({ end, layout }: PlacedHandle): Record<string, string> {
  const x = end === "first" ? layout.x : layout.x + layout.width;
  return { left: `${x * 100}%`, bottom: `${(1 - layout.y) * 100}%` };
}

function measureAt({ x, y }: { x: number; y: number }): MeasureId | undefined {
  return document.elementsFromPoint(x, y)
    .map(element => element.closest<HTMLElement>("[data-measure]")?.dataset.measure)
    .find(id => id !== undefined);
}

/** The handle snaps to the box under the pointer, at the occurrence closest to where it started. */
function onDrag(end: RangeEnd, point: { x: number; y: number }): void {
  const measure = measureAt(point);
  const run = range.run.value;
  if (!measure || !run) {
    return;
  }

  const [min, max] = range.getLimits(end);
  const position = findNearestPosition(props.song.getTimeline(), measure, end === "first" ? run.first : run.last, min, max);
  if (position !== undefined) {
    range.dragTo(end, position);
  }
}
</script>

<template>
  <ScorePage
    v-for="page of pages"
    :key="page.pageNumber"
    :page="page"
    class="pointer-events-none"
  >
    <ScoreBox
      v-for="(layout, i) of onPage(shadedBoxes, page, box => box)"
      :key="i"
      :layout="layout"
      class="opacity-30"
      :class="SECTION_COLORS[section.kind].background"
    />

    <ScoreLane
      v-for="handle of onPage(handles, page, item => item.layout)"
      :key="handle.end"
      :lane="lane"
      :style="handleStyle(handle)"
    >
      <template #bar>
        <SectionRangeHandle
          :ref="instance => range.setHandleElement(handle.end, instance as InstanceType<typeof SectionRangeHandle> | null)"
          class="top-1/2 left-0"
          :handle="handle"
          :count="song.getTimeline().length"
          :kind="section.kind"
          @drag="onDrag(handle.end, $event)"
          @drop="range.drop()"
          @keydown="range.onKeydown($event, handle.end)"
        />
      </template>
    </ScoreLane>
  </ScorePage>
</template>
