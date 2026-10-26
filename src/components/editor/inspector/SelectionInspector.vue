<script setup lang="ts">
import Button from "primevue/button";
import { computed, useId, useTemplateRef } from "vue";

import MeasureSelectionForm from "@/components/editor/measures/MeasureSelectionForm.vue";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import type Song from "@/core/models/song";

import InspectorGroup from "./InspectorGroup.vue";
import MarkerGroup from "./MarkerGroup.vue";
import RecordingGroup from "./RecordingGroup.vue";
import RehearsalGroup from "./RehearsalGroup.vue";
import SyncGroup from "./SyncGroup.vue";

const MAX_LISTED_BOXES = 3;

const props = defineProps<{
  song: Song;
}>();

const editor = injectMeasureEditor();
const { selection, selectedBoxes, selectionCount, selectedRuns, selectedRun, sectionMatches, currentReviewItem } = editor;
const timesId = useId();
const selectionForm = useTemplateRef<InstanceType<typeof MeasureSelectionForm>>("selectionForm");

const runs = computed(() => selectedRuns.value.map(run => ({ run, occurrence: props.song.getTimeline()[run.first]!.occurrence })));
const isConsecutive = computed(() => !!selectedRun.value);

const boxesSummary = computed(() => {
  if (selection.value.length === 1) {
    const [measure] = selection.value;
    return `${measure!.label}, ${measure!.beats} beats`;
  }

  return selectionCount.value <= MAX_LISTED_BOXES && selectedBoxes.value.length === 0
    ? selection.value.map(measure => measure.label).join(", ")
    : `${selectionCount.value} boxes`;
});

defineExpose({ removeBoxes: () => selectionForm.value?.removeBoxes() });
</script>

<template>
  <div class="flex flex-col">
    <div
      v-if="runs.length > 1"
      class="flex flex-col gap-2 pb-3"
    >
      <span
        :id="timesId"
        class="text-xs text-muted-color"
      >Time (follows the playhead)</span>
      <div
        role="group"
        class="flex flex-wrap gap-1"
        :aria-labelledby="timesId"
      >
        <Button
          v-for="{ run, occurrence } in runs"
          :key="run.first"
          :label="formatOrdinal(occurrence)"
          :aria-label="formatTimes(occurrence)"
          :aria-pressed="run === selectedRun"
          :severity="run === selectedRun ? 'primary' : 'secondary'"
          :text="run !== selectedRun"
          size="small"
          rounded
          @click="editor.seekRun(run)"
        />
      </div>
    </div>

    <template v-if="selectedRun">
      <RehearsalGroup
        :song="song"
        :run="selectedRun"
        :matches="sectionMatches"
      />
      <MarkerGroup
        :song="song"
        :run="selectedRun"
      />
      <RecordingGroup
        :song="song"
        :run="selectedRun"
      />
      <SyncGroup
        v-if="song.playerMode === 'audio'"
        :song="song"
        :run="selectedRun"
      />
    </template>
    <span
      v-else-if="selectedBoxes.length === 0"
      class="pb-3 text-sm text-muted-color"
    >Select consecutive measures to repeat, vamp or cut them.</span>

    <InspectorGroup
      id="boxes"
      :title="selectionCount === 1 ? 'Box' : 'Boxes'"
      :summary="boxesSummary"
      :force-open="!!currentReviewItem || !isConsecutive"
    >
      <MeasureSelectionForm ref="selectionForm" />
    </InspectorGroup>
  </div>
</template>
