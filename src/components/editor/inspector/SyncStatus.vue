<script setup lang="ts">
import { computed } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { formatOccurrence, formatTimes } from "@/core/models/locationFormat";
import { getRecordingStretches, type RecordedPass, type TimelineEntry } from "@/core/models/recording";
import { selectMeasures } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { getSyncStatus } from "@/core/models/warpEditing";
import { usePlayerStore } from "@/stores/player";

import InspectorSection from "./InspectorSection.vue";

const props = defineProps<{
  song: Song;
}>();

const player = usePlayerStore();
const selection = injectEditorSelection();

const status = computed(() => getSyncStatus(
  props.song.getTimeline(),
  props.song.getWarpMarkers(),
  getRecordingStretches(props.song.getMeasures(), props.song.getRecording()),
));

function measureLabel(entry: TimelineEntry): string {
  return props.song.findMeasure(entry.measure)?.label ?? "?";
}

function formatStretch({ first, last }: RecordedPass): string {
  const timeline = props.song.getTimeline();
  const start = timeline[first]!;
  const end = timeline[last]!;
  if (first === last) {
    return formatOccurrence(measureLabel(start), start.occurrence);
  }

  if (start.occurrence === end.occurrence) {
    const times = start.occurrence > 1 ? `, ${formatTimes(start.occurrence)}` : "";
    return `${measureLabel(start)} to ${measureLabel(end)}${times}`;
  }

  return `${formatOccurrence(measureLabel(start), start.occurrence)} to ${formatOccurrence(measureLabel(end), end.occurrence)}`;
}

type StatusIssue = { key: string; text: string; position: number };

const issues = computed<StatusIssue[]>(() => [
  ...status.value.unsyncedPasses.map(pass => ({
    key: `pass-${pass.first}`,
    text: `No sync point in ${formatStretch(pass)}`,
    position: pass.first,
  })),
  ...status.value.gaps.map(gap => ({
    key: `gap-${gap.first}`,
    text: `Measures ${formatStretch(gap)} may drift: ${gap.length} measures between sync points`,
    position: gap.first,
  })),
]);

const summary = computed(() => {
  const { count } = status.value;
  if (count === 0) {
    return "No sync points yet";
  }

  const points = count === 1 ? "1 sync point" : `${count} sync points`;
  return status.value.unsyncedPasses.length === 0 ? `${points}, every pass covered` : points;
});

/** Selects the measure where the issue starts and moves the playhead there, so it can be synced. */
function showIssue({ position }: StatusIssue): void {
  const measure = props.song.findMeasure(props.song.getTimeline()[position]!.measure);
  selection.select(measure?.layout ? selectMeasures([measure.id]) : { kind: "none" });
  player.seekPosition(position);
}
</script>

<template>
  <InspectorSection title="Audio sync">
    <ul class="flex flex-col gap-1 text-sm">
      <li class="flex items-start gap-2">
        <i
          class="pi mt-0.5"
          :class="status.count > 0 && status.unsyncedPasses.length === 0 ? 'pi-check text-primary' : 'pi-info-circle text-muted-color'"
          aria-hidden="true"
        />
        <span>{{ summary }}</span>
      </li>
      <li
        v-for="issue in issues"
        :key="issue.key"
        class="flex items-start gap-2"
      >
        <i
          class="pi pi-exclamation-circle mt-0.5 text-attention"
          aria-hidden="true"
        />
        <button
          type="button"
          class="rounded-sm text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          @click="showIssue(issue)"
        >
          {{ issue.text }}
        </button>
      </li>
    </ul>
    <span class="text-xs text-muted-color">Move the playhead to where a measure starts, select the measure and sync it, or add sync points in the timeline.</span>
  </InspectorSection>
</template>
