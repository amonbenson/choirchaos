<script setup lang="ts">
import { useElementSize } from "@vueuse/core";
import { computed, useId, useTemplateRef, watch } from "vue";

import { SECTION_COLORS, SECTION_CONTRAST_TEXT } from "@/components/score/sectionColors";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { formatLocation, formatOccurrence, formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { findRecordedPasses, getRecordingStretches, type RecordingStretch } from "@/core/models/recording";
import { describeSection, formatSectionChip } from "@/core/models/scoreOverlays";
import { isMarkerSelected, isPassSelected, isSectionSelected } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { getBeatTick, getStartTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{
  song: Song;
  /** The visible part of the song in player ticks, set by the waveform. Without it the lanes show the whole song and scroll. */
  view?: { start: number; end: number };
}>();

// Without a waveform to follow, the lanes scroll so that every measure stays readable.
const MIN_CELL_WIDTH_PX = 28;
const MIN_TEXT_WIDTH_PX = 18;
const AUTO_SCROLL_MARGIN = 0.1;

type Block = { left: number; width: number };

const player = usePlayerStore();
const { selection, selectAndSeek } = injectEditorSelection();
const viewport = useTemplateRef<HTMLElement>("viewport");
const { width: viewportWidth } = useElementSize(viewport);
const laneIds = { markers: useId(), sections: useId(), recording: useId(), measures: useId() };

const timeline = computed(() => player.timeline);
const range = computed(() => props.view ?? { start: 0, end: player.duration || 1 });
const contentWidth = computed(() => props.view
  ? viewportWidth.value
  : Math.max(viewportWidth.value, timeline.value.length * MIN_CELL_WIDTH_PX));
const pixelsPerTick = computed(() => contentWidth.value / Math.max(1, range.value.end - range.value.start));

function toX(tick: number): number {
  return (tick - range.value.start) * pixelsPerTick.value;
}

// Blocks are cut to the visible part, so a zoomed-in pass still shows its text.
function toBlock(start: number, end: number): Block {
  const left = Math.max(-1, toX(start));
  const right = Math.min(contentWidth.value + 1, toX(end));
  return { left, width: Math.max(1, right - left) };
}

function blockStyle({ left, width }: Block): Record<string, string> {
  return { left: `${left}px`, width: `${width}px` };
}

function isVisible({ left, width }: Block): boolean {
  return left + width >= 0 && left <= contentWidth.value;
}

const label = (id: MeasureId): string => props.song.findMeasure(id)?.label ?? "?";

const cells = computed(() => timeline.value.map(position => ({
  position: position.position,
  label: label(position.measure),
  occurrence: position.occurrence,
  name: formatOccurrence(label(position.measure), position.occurrence),
  block: toBlock(getStartTick(position), position.endTick),
})));

const markers = computed(() => props.song.getMarkers().flatMap((marker) => {
  const tick = player.getLocationTick(marker.at);
  if (tick === undefined) {
    return [];
  }

  const name = `Marker ${marker.text} at ${formatLocation(props.song, marker.at)}`;
  return [{ marker, left: toX(tick), name, selected: isMarkerSelected(selection.value, marker) }];
}));

const sections = computed(() => props.song.getSections().flatMap((section, index) => {
  const passes = findRecordedPasses(props.song.getTimeline(), section);
  const first = timeline.value[passes[0]?.first ?? -1];
  const last = timeline.value[passes.at(-1)?.last ?? -1];
  if (!first || !last) {
    return [];
  }

  return [{
    index,
    section,
    kind: section.kind,
    text: formatSectionChip(section),
    name: describeSection(props.song.getMeasures(), section),
    block: toBlock(getBeatTick(first, section.from.beat), getBeatTick(last, section.to.beat + 1)),
    selected: isSectionSelected(selection.value, section),
  }];
}));

const stretches = computed(() => getRecordingStretches(props.song.getMeasures(), props.song.getRecording()).flatMap((stretch, index) => {
  const first = timeline.value[stretch.first];
  const last = timeline.value[stretch.last];
  if (!first || !last) {
    return [];
  }

  return [{
    stretch,
    index,
    text: formatStretch(stretch, false),
    name: formatStretch(stretch, true),
    block: toBlock(getStartTick(first), last.endTick),
    selected: isPassSelected(selection.value, index),
  }];
}));

const playheadX = computed(() => toX(player.position));

function formatRange({ span }: RecordingStretch): string {
  return span.from === span.to ? label(span.from) : `${label(span.from)} to ${label(span.to)}`;
}

/** "19 to 20, 2nd" on the lane, "19 to 20, 2nd time, after 20" as its name. */
function formatStretch(stretch: RecordingStretch, long: boolean): string {
  const parts = [formatRange(stretch)];
  if (stretch.occurrence > 1) {
    parts.push(long ? formatTimes(stretch.occurrence) : formatOrdinal(stretch.occurrence));
  }

  if (long && stretch.after) {
    parts.push(`after ${formatOccurrence(label(stretch.after.measure), stretch.after.occurrence)}`);
  }

  return parts.join(", ");
}

function hasText(block: Block): boolean {
  return block.width >= MIN_TEXT_WIDTH_PX;
}

// Keeps the playhead in view while the lanes scroll on their own.
watch(playheadX, (x) => {
  const element = viewport.value;
  if (props.view || !element || (x >= element.scrollLeft && x <= element.scrollLeft + element.clientWidth)) {
    return;
  }

  element.scrollLeft = Math.max(0, x - element.clientWidth * AUTO_SCROLL_MARGIN);
});
</script>

<template>
  <div class="flex min-w-0 gap-2 text-xs">
    <div class="flex w-16 flex-none flex-col gap-1 text-muted-color">
      <span
        :id="laneIds.markers"
        class="flex h-5 items-center"
      >Markers</span>
      <span
        :id="laneIds.sections"
        class="flex h-5 items-center"
      >Sections</span>
      <span
        :id="laneIds.recording"
        class="flex h-6 items-center"
      >Recording</span>
      <span
        :id="laneIds.measures"
        class="flex h-5 items-center"
      >Measures</span>
    </div>

    <div
      ref="viewport"
      class="relative min-w-0 flex-1"
      :class="view ? 'overflow-hidden' : 'overflow-x-auto overflow-y-hidden pb-1'"
    >
      <div
        class="relative flex flex-col gap-1"
        :style="{ width: `${contentWidth}px` }"
      >
        <ul
          class="relative h-5"
          :aria-labelledby="laneIds.markers"
        >
          <li
            v-for="item in markers"
            :key="`${item.marker.at.measure}-${item.marker.at.occurrence}-${item.marker.text}`"
            class="absolute top-0 h-5"
            :style="{ left: `${item.left}px` }"
          >
            <button
              type="button"
              class="flex h-5 max-w-28 items-center gap-1 rounded-sm px-1 font-semibold whitespace-nowrap text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
              :class="item.selected ? 'bg-primary/15' : ''"
              :aria-label="item.name"
              :aria-pressed="item.selected"
              @click="selectAndSeek({ kind: 'marker', marker: item.marker })"
            >
              <i
                class="pi pi-bookmark text-[0.625rem]"
                aria-hidden="true"
              />
              <span class="truncate">{{ item.marker.text }}</span>
            </button>
          </li>
        </ul>

        <ul
          class="relative h-5"
          :aria-labelledby="laneIds.sections"
        >
          <li
            v-for="item in sections"
            :key="item.index"
            class="absolute top-0 h-5"
            :style="blockStyle(item.block)"
          >
            <button
              type="button"
              class="size-full truncate rounded-sm px-1.5 text-left font-semibold focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
              :class="[
                item.kind === 'cut'
                  ? ['border hatch-section-cut', SECTION_COLORS.cut.border]
                  : [SECTION_COLORS[item.kind].background, SECTION_CONTRAST_TEXT],
                item.selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface-0 dark:ring-offset-surface-900' : '',
              ]"
              :aria-label="item.name"
              :aria-pressed="item.selected"
              @click="selectAndSeek({ kind: 'section', from: item.section.from })"
            >
              <span v-if="hasText(item.block)">{{ item.text }}</span>
            </button>
          </li>
        </ul>

        <ul
          class="relative h-6"
          :aria-labelledby="laneIds.recording"
        >
          <li
            v-for="item in stretches"
            :key="item.stretch.first"
            class="absolute top-0 h-6"
            :style="blockStyle(item.block)"
          >
            <button
              type="button"
              class="size-full truncate rounded-sm border px-1.5 text-left focus-visible:outline-2 focus-visible:outline-primary"
              :class="item.selected
                ? 'border-primary bg-primary/15 font-semibold'
                : 'border-surface-300 bg-surface-0 hover:bg-surface-100 dark:border-surface-600 dark:bg-surface-900 dark:hover:bg-surface-800'"
              :aria-label="item.name"
              :aria-pressed="item.selected"
              @click="selectAndSeek({ kind: 'pass', index: item.index })"
            >
              <span v-if="hasText(item.block)">{{ item.text }}</span>
            </button>
          </li>
        </ul>

        <ul
          class="relative h-5"
          :aria-labelledby="laneIds.measures"
        >
          <template
            v-for="cell in cells"
            :key="cell.position"
          >
            <li
              v-if="isVisible(cell.block)"
              class="absolute top-0 h-5"
              :style="blockStyle(cell.block)"
            >
              <button
                type="button"
                class="size-full overflow-hidden border-l border-surface-200 text-center whitespace-nowrap text-muted-color tabular-nums hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-primary dark:border-surface-700 dark:hover:bg-surface-800"
                :aria-label="cell.name"
                @click="player.seekPosition(cell.position)"
              >
                <template v-if="hasText(cell.block)">
                  {{ cell.label }}<sup
                    v-if="cell.occurrence > 1"
                    aria-hidden="true"
                  >{{ cell.occurrence }}</sup>
                </template>
              </button>
            </li>
          </template>
        </ul>

        <div
          v-if="player.ready && playheadX >= 0 && playheadX <= contentWidth"
          class="pointer-events-none absolute inset-y-0 w-0.5 bg-primary"
          :style="{ left: `${playheadX}px` }"
          aria-hidden="true"
        />
      </div>
    </div>
  </div>
</template>
