<script setup lang="ts">
import Button from "primevue/button";
import { computed, ref, useId } from "vue";

import { formatOccurrence, formatTimes } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { countOccurrences, getRecordingStretches, type RecordingStretch } from "@/core/models/recording";
import type Song from "@/core/models/song";

import InspectorGroup from "./InspectorGroup.vue";
import RecordingTextForm from "./RecordingTextForm.vue";

const props = defineProps<{
  song: Song;
}>();

const listId = useId();
const editingText = ref(false);

const timeline = computed(() => props.song.getTimeline());
const editable = computed(() => props.song.isRecordingEditable());
const stretches = computed(() => getRecordingStretches(props.song.getMeasures(), props.song.getRecording()));
const summary = computed(() => timeline.value.length === 1 ? "1 measure" : `${timeline.value.length} measures`);

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
  <InspectorGroup
    id="recording"
    title="Recording"
    :summary="summary"
  >
    <span
      :id="listId"
      class="text-xs text-muted-color"
    >The order the backing track plays the measures in</span>
    <ol
      class="flex flex-col"
      :aria-labelledby="listId"
    >
      <li
        v-for="stretch in stretches"
        :key="stretch.first"
        class="flex items-baseline gap-3 py-0.5 text-sm"
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
      </li>
    </ol>

    <template v-if="editable">
      <RecordingTextForm
        v-if="editingText"
        :song="song"
        @close="editingText = false"
      />
      <template v-else>
        <span class="text-xs text-muted-color">Select measures on the score to record them more than once or to jump elsewhere after them.</span>
        <Button
          label="Edit as text"
          severity="secondary"
          size="small"
          class="self-start"
          @click="editingText = true"
        />
      </template>
    </template>
    <span
      v-else
      class="text-xs text-muted-color"
    >A MIDI song plays its beat map, so its recording cannot be changed here.</span>
  </InspectorGroup>
</template>
