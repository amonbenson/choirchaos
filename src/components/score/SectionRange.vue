<script setup lang="ts">
import { computed, nextTick, shallowRef } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import { formatLocation } from "@/core/models/locationFormat";
import type { MeasureId, MeasureLayout } from "@/core/models/measure";
import type { RecordedPass } from "@/core/models/recording";
import { formatSectionName, getBarCenterOffset } from "@/core/models/scoreOverlays";
import { findNearestPosition, replaceSections, type Section, validateSections, withRun } from "@/core/models/sections";
import type Song from "@/core/models/song";
import { lowerFirst } from "@/core/utils/text";

import type { VisiblePage } from "./PdfViewer.vue";
import ScoreBox from "./ScoreBox.vue";
import ScorePage from "./ScorePage.vue";
import { SECTION_COLORS } from "./sectionColors";
import SectionRangeHandle from "./SectionRangeHandle.vue";

const props = defineProps<{
  song: Song;
  section: Section;
  /** The section's first pass. */
  run: RecordedPass;
  /** The lane of the section's bar, where the handles sit. */
  lane: number;
  pages: readonly VisiblePage[];
}>();

const { notifyError } = useNotify();
const editorSelection = injectEditorSelection();

type RangeEnd = "first" | "last";

type RangeHandle = { end: RangeEnd; position: number; layout: MeasureLayout; name: string; valueText: string };

const RANGE_STEP_KEYS: Record<string, number> = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };

/** The run a handle is being dragged to, shown on the score until it is dropped. */
const dragged = shallowRef<{ end: RangeEnd; run: RecordedPass }>();

const shownRun = computed(() => dragged.value?.run ?? props.run);

const handles = computed<RangeHandle[]>(() => {
  const name = formatSectionName(props.song.getMeasures(), props.section);
  return (["first", "last"] as const).flatMap((end) => {
    const position = end === "first" ? shownRun.value.first : shownRun.value.last;
    const entry = props.song.getTimeline()[position];
    const layout = entry && props.song.findMeasure(entry.measure)?.layout;
    const label = end === "first" ? "First" : "Last";
    return entry && layout ? [{ end, position, layout, name: `${label} measure of ${lowerFirst(name)}`, valueText: formatLocation(props.song, entry) }] : [];
  });
});

/** The boxes of the section's first pass, or of where a handle is being dragged to. */
const outlinedBoxes = computed(() => {
  const ids = new Set(props.song.getTimeline().slice(shownRun.value.first, shownRun.value.last + 1).map(entry => entry.measure));
  return [...ids].flatMap(id => props.song.findMeasure(id)?.layout ?? []);
});

function onPage<T>(items: readonly T[], page: VisiblePage, layoutOf: (item: T) => MeasureLayout): T[] {
  return items.filter(item => layoutOf(item).page === page.pageNumber);
}

function handleStyle({ end, layout }: RangeHandle): Record<string, string> {
  const x = end === "first" ? layout.x : layout.x + layout.width;
  return { left: `${x * 100}%`, top: `calc(${layout.y * 100}% - ${getBarCenterOffset(props.lane)}px)` };
}

function movedRun(run: RecordedPass, end: RangeEnd, position: number): RecordedPass {
  return end === "first" ? { first: position, last: run.last } : { first: run.first, last: position };
}

function measureAt({ x, y }: { x: number; y: number }): MeasureId | undefined {
  return document.elementsFromPoint(x, y)
    .map(element => element.closest<HTMLElement>("[data-measure]")?.dataset.measure)
    .find(id => id !== undefined);
}

/** The handle snaps to the box under the pointer, at the occurrence closest to where it started. */
function onDrag(end: RangeEnd, point: { x: number; y: number }): void {
  const measure = measureAt(point);
  if (!measure) {
    return;
  }

  const timeline = props.song.getTimeline();
  const position = end === "first"
    ? findNearestPosition(timeline, measure, props.run.first, 0, props.run.last)
    : findNearestPosition(timeline, measure, props.run.last, props.run.first, timeline.length - 1);
  if (position !== undefined) {
    dragged.value = { end, run: movedRun(props.run, end, position) };
  }
}

async function onDrop(): Promise<void> {
  const drag = dragged.value;
  dragged.value = undefined;
  if (drag) {
    await moveSection(drag.run, drag.end);
  }
}

function getKeyTarget(key: string, current: number, min: number, max: number): number | undefined {
  const step = RANGE_STEP_KEYS[key];
  if (step !== undefined) {
    return current + step;
  }

  if (key === "Home") {
    return min;
  }

  return key === "End" ? max : undefined;
}

function onKeydown(event: KeyboardEvent, end: RangeEnd): void {
  const [min, max] = end === "first" ? [0, props.run.last] : [props.run.first, props.song.getTimeline().length - 1];
  const current = end === "first" ? props.run.first : props.run.last;
  const target = getKeyTarget(event.key, current, min, max);
  if (target === undefined) {
    return;
  }

  // Arrow keys also step the playhead, which must not happen while a handle moves.
  event.preventDefault();
  event.stopPropagation();
  const position = Math.max(min, Math.min(max, target));
  if (position !== current) {
    moveSection(movedRun(props.run, end, position), end);
  }
}

type Focusable = { focus: () => void; hasFocus: () => boolean };

const handleElements = new Map<RangeEnd, Focusable>();

function setHandleElement(end: RangeEnd, handle: Focusable | null): void {
  if (handle) {
    handleElements.set(end, handle);
  } else {
    handleElements.delete(end);
  }
}

/** Saves the section over whole measures of the new run and keeps it selected, so its handles stay. */
async function moveSection(run: RecordedPass, end: RangeEnd): Promise<void> {
  if (run.first === props.run.first && run.last === props.run.last) {
    return;
  }

  const measures = props.song.getMeasures();
  const timeline = props.song.getTimeline();
  const moved = withRun(measures, timeline, props.section, run);
  const sections = replaceSections(props.song.getSections(), [props.section], moved);
  const [issue] = validateSections(measures, timeline, sections);
  if (issue) {
    notifyError("Could not move the section", new Error(issue.reason));
    return;
  }

  // The handle may land on another page, which renders it anew.
  const hadFocus = handleElements.get(end)?.hasFocus() ?? false;
  try {
    await props.song.editLayers({ sections });
    editorSelection.select({ kind: "section", from: moved.from });
    if (hadFocus) {
      await nextTick();
      handleElements.get(end)?.focus();
    }
  } catch (error) {
    notifyError("Could not move the section", error);
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
      v-for="(layout, i) of onPage(outlinedBoxes, page, box => box)"
      :key="i"
      :layout="layout"
      class="outline-2 outline-dashed"
      :class="SECTION_COLORS[section.kind].outline"
    />

    <SectionRangeHandle
      v-for="handle of onPage(handles, page, item => item.layout)"
      :key="handle.end"
      :ref="instance => setHandleElement(handle.end, instance as Focusable | null)"
      :style="handleStyle(handle)"
      :aria-label="handle.name"
      :aria-valuemin="1"
      :aria-valuemax="song.getTimeline().length"
      :aria-valuenow="handle.position + 1"
      :aria-valuetext="handle.valueText"
      @drag="onDrag(handle.end, $event)"
      @drop="onDrop"
      @keydown="onKeydown($event, handle.end)"
    >
      <span
        class="pointer-events-none h-4 w-2 rounded-sm ring-2 ring-surface-0 dark:ring-surface-900"
        :class="SECTION_COLORS[section.kind].background"
      />
    </SectionRangeHandle>
  </ScorePage>
</template>
