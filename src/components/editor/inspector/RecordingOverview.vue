<script setup lang="ts">
import { computed, useId } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { formatOccurrence, formatTimes } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { countOccurrences, getRecordingStretches, type RecordingStretch } from "@/core/models/recording";
import type Song from "@/core/models/song";

import InspectorSection from "./InspectorSection.vue";

const props = defineProps<{
  song: Song;
}>();

const selection = injectEditorSelection();
const listId = useId();

const timeline = computed(() => props.song.getTimeline());
const stretches = computed(() => getRecordingStretches(props.song.getMeasures(), props.song.getRecording()));

const label = (id: MeasureId): string => props.song.findMeasure(id)?.label ?? "?";

function formatRange({ span }: RecordingStretch): string {
  return span.from === span.to ? label(span.from) : `${label(span.from)} to ${label(span.to)}`;
}

/** The first time is only named for measures the recording plays again. */
function formatPass({ span, occurrence }: RecordingStretch): string | undefined {
  return countOccurrences(timeline.value, span.from) > 1 ? formatTimes(occurrence) : undefined;
}

function formatAfter({ after }: RecordingStretch): string | undefined {
  return after && `after ${formatOccurrence(label(after.measure), after.occurrence)}`;
}
</script>

<template>
  <InspectorSection title="Recording">
    <span
      :id="listId"
      class="text-xs text-muted-color"
    >The order the backing track plays the measures in</span>
    <ol
      class="flex flex-col"
      :aria-labelledby="listId"
    >
      <li
        v-for="(stretch, index) in stretches"
        :key="stretch.first"
      >
        <button
          type="button"
          class="flex w-full items-baseline gap-3 rounded px-2 py-0.5 text-left text-sm hover:bg-surface-100 focus-visible:outline-2 focus-visible:outline-primary dark:hover:bg-surface-800"
          @click="selection.selectAndSeek({ kind: 'pass', index })"
        >
          <strong class="min-w-16">{{ formatRange(stretch) }}</strong>
          <span
            v-if="formatPass(stretch)"
            class="text-muted-color"
          >{{ formatPass(stretch) }}</span>
          <span
            v-if="formatAfter(stretch)"
            class="ml-auto text-xs text-muted-color"
          >{{ formatAfter(stretch) }}</span>
        </button>
      </li>
    </ol>
  </InspectorSection>
</template>
