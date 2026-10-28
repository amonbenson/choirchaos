<script setup lang="ts">
import { computed } from "vue";

import { SECTION_COLORS, SECTION_CONTRAST_TEXT } from "@/components/score/sectionColors";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import type { TimelineAxis } from "@/composables/useTimelineAxis";
import type { Tick } from "@/core/midi/types";
import { formatLocation, formatOccurrence, formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { getRecordingStretches, type RecordingStretch } from "@/core/models/recording";
import { describeSection, formatSectionChip } from "@/core/models/scoreOverlays";
import { getSectionPasses, type Section } from "@/core/models/sections";
import { isMarkerSelected, isPassSelected, isSectionSelected } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { getSectionTicks } from "@/core/player/route";
import { getBeatTick, getStartTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";

import TimelineLaneItem from "./TimelineLaneItem.vue";
import TimelineSectionRange from "./TimelineSectionRange.vue";

export type LaneName = "Markers" | "Sections" | "Recording" | "Measures";

const props = defineProps<{
  song: Song;
  axis: TimelineAxis;
  /** IDs of the visible lane titles, which name the lane lists. */
  titleIds: Record<LaneName, string>;
}>();

const player = usePlayerStore();
const { selection, selected, selectAndSeek } = injectEditorSelection();

const timeline = computed(() => player.timeline);
const label = (id: MeasureId): string => props.song.findMeasure(id)?.label ?? "?";

// Every lane only renders what lies in the view, so nothing outside it leaves a sliver at the edge.
const markers = computed(() => props.song.getMarkers().flatMap((marker) => {
  const tick = player.getLocationTick(marker.at);
  if (tick === undefined || !props.axis.isVisible(tick)) {
    return [];
  }

  return [{
    marker,
    block: { left: props.axis.toX(tick) },
    name: `Marker ${marker.text} at ${formatLocation(props.song, marker.at)}`,
    selected: isMarkerSelected(selection.value, marker),
  }];
}));

/** A vamp loops its own pass, so it is drawn there; the recorded passes it extends over only get an outline. */
function getOwnPassTicks(section: Section, all: readonly Section[]): { start: Tick; end: Tick } | undefined {
  if (section.kind !== "vamp") {
    return getSectionTicks(timeline.value, all, section);
  }

  const own = getSectionPasses(timeline.value, all, section)[0];
  const first = own && timeline.value[own.first];
  const last = own && timeline.value[own.last];
  return first && last ? { start: getBeatTick(first, section.from.beat), end: getBeatTick(last, section.to.beat + 1) } : undefined;
}

const sections = computed(() => props.song.getSections().flatMap((section, index, all) => {
  const ticks = getOwnPassTicks(section, all);
  const block = ticks && props.axis.toBlock(ticks.start, ticks.end);
  if (!block) {
    return [];
  }

  return [{
    index,
    section,
    block,
    text: formatSectionChip(section),
    name: describeSection(props.song.getMeasures(), section),
    colors: [SECTION_COLORS[section.kind].background, SECTION_CONTRAST_TEXT],
    selected: isSectionSelected(selection.value, section),
  }];
}));

const vampExtensions = computed(() => props.song.getSections().flatMap((section, index, all) => {
  if (section.kind !== "vamp" || getSectionPasses(timeline.value, all, section).length < 2) {
    return [];
  }

  const ticks = getSectionTicks(timeline.value, all, section);
  const block = ticks && props.axis.toBlock(ticks.start, ticks.end);
  return block ? [{ index, block }] : [];
}));

const selectedSection = computed(() => selected.value.kind === "section" ? selected.value.section : undefined);

const recordingStretches = computed(() => getRecordingStretches(props.song.getMeasures(), props.song.getRecording()));

const stretches = computed(() => recordingStretches.value.flatMap((stretch, index) => {
  const first = timeline.value[stretch.first];
  const last = timeline.value[stretch.last];
  const block = first && last && props.axis.toBlock(getStartTick(first), last.endTick);
  if (!block) {
    return [];
  }

  return [{
    stretch,
    index,
    block,
    text: formatStretch(stretch, false),
    name: formatStretch(stretch, true),
    selected: isPassSelected(selection.value, index),
  }];
}));

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
</script>

<template>
  <ul
    class="relative h-6"
    :aria-labelledby="titleIds.Markers"
  >
    <TimelineLaneItem
      v-for="item in markers"
      :key="`${item.marker.at.measure}-${item.marker.at.occurrence}-${item.marker.text}`"
      :block="item.block"
      :name="item.name"
      :pressed="item.selected"
      class="font-semibold text-primary hover:bg-primary/10"
      @click="selectAndSeek({ kind: 'marker', marker: item.marker })"
    >
      <i
        class="pi pi-bookmark text-[0.625rem]"
        aria-hidden="true"
      />
      <span class="truncate">{{ item.marker.text }}</span>
    </TimelineLaneItem>
  </ul>

  <div class="relative h-6">
    <div
      v-for="extension in vampExtensions"
      :key="extension.index"
      class="pointer-events-none absolute inset-y-0 rounded-sm bg-section-vamp/20"
      :style="{ left: `${extension.block.left + 1}px`, width: `${extension.block.width - 2}px` }"
      aria-hidden="true"
    />
    <ul
      class="relative h-6"
      :aria-labelledby="titleIds.Sections"
    >
      <TimelineLaneItem
        v-for="item in sections"
        :key="item.index"
        :block="item.block"
        :name="item.name"
        :pressed="item.selected"
        class="font-semibold"
        :class="item.colors"
        @click="selectAndSeek({ kind: 'section', from: item.section.from })"
      >
        <span class="truncate">{{ item.text }}</span>
      </TimelineLaneItem>
    </ul>
    <TimelineSectionRange
      v-if="selectedSection"
      :song="song"
      :section="selectedSection"
      :axis="axis"
    />
  </div>

  <ul
    class="relative h-6"
    :aria-labelledby="titleIds.Recording"
  >
    <TimelineLaneItem
      v-for="item in stretches"
      :key="item.stretch.first"
      :block="item.block"
      :name="item.name"
      :pressed="item.selected"
      class="bg-surface-100 hover:bg-surface-100 dark:bg-surface-800 dark:hover:bg-surface-700"
      @click="selectAndSeek({ kind: 'pass', index: item.index })"
    >
      <span class="truncate">{{ item.text }}</span>
    </TimelineLaneItem>
  </ul>
</template>
