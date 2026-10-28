<script setup lang="ts">
import { computed } from "vue";

import { getClickIntent, injectEditorSelection } from "@/composables/useEditorSelection";
import type { TimelineAxis } from "@/composables/useTimelineAxis";
import { formatOccurrence } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { isMeasureSelected } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { findWarpMarker } from "@/core/models/warpEditing";
import { getStartTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";

import { getMedian, MEASURE_STEPS, pickRulerStep, type RulerTick } from "./rulerTicks";
import { SYNC_POINT_COLORS } from "./syncColors";
import TimelineLaneItem from "./TimelineLaneItem.vue";
import TimelineRuler from "./TimelineRuler.vue";

const props = defineProps<{
  song: Song;
  axis: TimelineAxis;
  /** ID of the visible lane title, which names the measure list. */
  titleId: string;
}>();

// Room for a measure number like "123" with its occurrence.
const MIN_LABEL_SPACING_PX = 28;
// Below this, ticks for every measure would merge into a solid bar.
const MIN_TICK_SPACING_PX = 4;

const player = usePlayerStore();
const { selection, run, touchMultiSelect, selectPosition, clickMeasure } = injectEditorSelection();

const timeline = computed(() => player.timeline);
const label = (id: MeasureId): string => props.song.findMeasure(id)?.label ?? "?";

// The typical measure sets the step for the whole song, so labels do not jump while scrolling.
const medianMeasureTicks = computed(() => getMedian(timeline.value.map(position => position.endTick - getStartTick(position))) ?? 0);
const measureWidth = computed(() => medianMeasureTicks.value / (props.axis.toTick(1) - props.axis.toTick(0)));
const step = computed(() => pickRulerStep(MEASURE_STEPS, measureWidth.value, MIN_LABEL_SPACING_PX));

const cells = computed(() => timeline.value.flatMap((position) => {
  const block = props.axis.toBlock(getStartTick(position), position.endTick);
  if (!block) {
    return [];
  }

  return [{
    position: position.position,
    measure: position.measure,
    block,
    name: formatOccurrence(label(position.measure), position.occurrence),
    selected: isCellSelected(position.measure, position.position),
  }];
}));

const ticks = computed<RulerTick[]>(() => timeline.value.flatMap((position) => {
  const start = getStartTick(position);
  const labelled = position.position % step.value === 0;
  if (!props.axis.isVisible(start) || (!labelled && measureWidth.value < MIN_TICK_SPACING_PX)) {
    return [];
  }

  return [{
    key: position.position,
    x: Math.round(props.axis.toX(start)),
    label: labelled ? label(position.measure) : undefined,
    superscript: labelled && position.occurrence > 1 ? String(position.occurrence) : undefined,
    color: findWarpMarker(props.song.getWarpMarkers(), position) ? SYNC_POINT_COLORS.text : undefined,
  }];
}));

/** The selected measures are edited in the pass at the playhead, so only that pass shows them selected. */
function isCellSelected(measure: MeasureId, position: number): boolean {
  const pass = run.value;
  return isMeasureSelected(selection.value, measure) && (!pass || (position >= pass.first && position <= pass.last));
}

/** A plain click selects the measure in this pass, Ctrl/Cmd and Shift add to the selection as on the score. */
function onCellClick(event: MouseEvent, measure: MeasureId, position: number): void {
  const pointerType = "pointerType" in event && typeof event.pointerType === "string" ? event.pointerType : "mouse";
  const intent = getClickIntent(event, pointerType, touchMultiSelect.value);
  if (intent === "select") {
    selectPosition(position);
    return;
  }

  clickMeasure(measure, intent);
  player.seekPosition(position);
}
</script>

<template>
  <div class="relative h-6 flex-none">
    <ul
      class="relative h-full"
      :aria-labelledby="titleId"
    >
      <TimelineLaneItem
        v-for="cell in cells"
        :key="cell.position"
        :block="cell.block"
        :name="cell.name"
        :pressed="cell.selected"
        class="rounded-none hover:bg-surface-200 dark:hover:bg-surface-800"
        @click="onCellClick($event, cell.measure, cell.position)"
      />
    </ul>
    <TimelineRuler
      :ticks="ticks"
      edge="bottom"
    />
  </div>
</template>
