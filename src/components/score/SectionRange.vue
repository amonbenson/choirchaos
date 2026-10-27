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

import type { VisiblePage } from "./PdfViewer.vue";
import ScoreBox from "./ScoreBox.vue";
import ScorePage from "./ScorePage.vue";
import { SECTION_COLORS } from "./sectionColors";

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
  const subject = name.charAt(0).toLowerCase() + name.slice(1);
  return (["first", "last"] as const).flatMap((end) => {
    const position = end === "first" ? shownRun.value.first : shownRun.value.last;
    const entry = props.song.getTimeline()[position];
    const layout = entry && props.song.findMeasure(entry.measure)?.layout;
    const label = end === "first" ? "First" : "Last";
    return entry && layout ? [{ end, position, layout, name: `${label} measure of ${subject}`, valueText: formatLocation(props.song, entry) }] : [];
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

function measureUnder(event: PointerEvent): MeasureId | undefined {
  return document.elementsFromPoint(event.clientX, event.clientY)
    .map(element => element.closest<HTMLElement>("[data-measure]")?.dataset.measure)
    .find(id => id !== undefined);
}

function onPointerDown(event: PointerEvent, end: RangeEnd): void {
  if (event.button !== 0) {
    return;
  }

  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  dragged.value = { end, run: props.run };
}

/** The handle snaps to the box under the pointer, at the occurrence closest to where it started. */
function onPointerMove(event: PointerEvent): void {
  const drag = dragged.value;
  const measure = drag && measureUnder(event);
  if (!drag || !measure) {
    return;
  }

  const timeline = props.song.getTimeline();
  const position = drag.end === "first"
    ? findNearestPosition(timeline, measure, props.run.first, 0, props.run.last)
    : findNearestPosition(timeline, measure, props.run.last, props.run.first, timeline.length - 1);
  if (position !== undefined) {
    dragged.value = { ...drag, run: movedRun(props.run, drag.end, position) };
  }
}

async function onPointerUp(): Promise<void> {
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

const handleElements = new Map<RangeEnd, HTMLElement>();

function setHandleElement(end: RangeEnd, element: Element | null): void {
  if (element instanceof HTMLElement) {
    handleElements.set(end, element);
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
  const hadFocus = document.activeElement === handleElements.get(end);
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

    <div
      v-for="handle of onPage(handles, page, item => item.layout)"
      :key="handle.end"
      :ref="element => setHandleElement(handle.end, element as Element | null)"
      class="pointer-events-auto absolute flex h-6 w-5 -translate-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-primary"
      :style="handleStyle(handle)"
      role="slider"
      tabindex="0"
      :aria-label="handle.name"
      aria-orientation="horizontal"
      :aria-valuemin="1"
      :aria-valuemax="song.getTimeline().length"
      :aria-valuenow="handle.position + 1"
      :aria-valuetext="handle.valueText"
      @pointerdown.stop="onPointerDown($event, handle.end)"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="dragged = undefined"
      @click.stop
      @touchstart.stop
      @touchmove.stop
      @keydown="onKeydown($event, handle.end)"
    >
      <span
        class="pointer-events-none h-4 w-2 rounded-sm ring-2 ring-surface-0 dark:ring-surface-900"
        :class="SECTION_COLORS[section.kind].background"
      />
    </div>
  </ScorePage>
</template>
