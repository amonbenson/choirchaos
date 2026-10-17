<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import ProgressBar from "primevue/progressbar";
import { computed } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import { hasMeasureDetectionChanges } from "@/core/models/measureDetection";

const editor = injectMeasureEditor();
const { measures, saving, detection } = editor;
const { progress, detected, plan, running, canCreateMeasures, replacePlaced, createMissing, beats } = detection;
const { notifyError, notifySuccess } = useNotify();

const hasPlacedMeasures = computed(() => measures.value.some(measure => measure.layout));

const progressValue = computed(() => {
  const value = progress.value;
  return value?.stage === "detect" ? Math.round((value.done / value.total) * 100) : undefined;
});

const progressLabel = computed(() => {
  const value = progress.value;
  if (value?.stage === "detect") {
    return `Reading page ${Math.min(value.done + 1, value.total)} of ${value.total}`;
  }

  return value?.stage === "label" ? "Reading measure numbers" : "Loading the detector";
});

function pluralize(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

async function apply(): Promise<void> {
  const value = plan.value;
  if (!value) {
    return;
  }

  try {
    await editor.applyDetection();
    notifySuccess("Measures placed", pluralize(value.placements.length + value.additions.length, "measure"));
  } catch (error) {
    notifyError("Could not save the measures", error);
  }
}
</script>

<template>
  <div
    v-if="running"
    class="flex flex-col gap-3"
  >
    <span class="text-sm">{{ progressLabel }}</span>
    <ProgressBar
      :value="progressValue"
      :mode="progressValue === undefined ? 'indeterminate' : 'determinate'"
      :show-value="false"
      class="h-1"
    />
    <span class="text-xs text-muted-color">The first run downloads the detector, which takes a moment. Large scores can take a minute.</span>
    <div class="flex justify-end">
      <Button
        label="Cancel"
        severity="secondary"
        size="small"
        text
        @click="detection.discard()"
      />
    </div>
  </div>

  <div
    v-else-if="plan"
    class="flex flex-col gap-4"
  >
    <span
      v-if="detected!.length === 0"
      class="text-sm"
    >No measures were found on the score.</span>
    <ul
      v-else
      class="flex flex-col gap-1 text-sm"
      aria-label="Detection result"
    >
      <li
        v-if="plan.placements.length > 0"
        class="flex items-center gap-2"
      >
        <span class="size-3 flex-none rounded-xs border-2 border-dashed border-primary" />
        Places {{ pluralize(plan.placements.length, "measure") }}
      </li>
      <li
        v-if="plan.additions.length > 0"
        class="flex items-center gap-2"
      >
        <span class="size-3 flex-none rounded-xs border-2 border-dashed border-primary" />
        Adds {{ pluralize(plan.additions.length, "new measure") }}
      </li>
      <li
        v-if="plan.lowConfidence.length > 0"
        class="flex items-center gap-2"
      >
        <span class="size-3 flex-none rounded-xs border-2 border-dashed border-amber-500" />
        {{ plan.lowConfidence.length }} unsure, marked for review
      </li>
      <li
        v-if="plan.unnumbered.length > 0"
        class="flex items-center gap-2"
      >
        <span class="size-3 flex-none rounded-xs border-2 border-dashed border-red-500" />
        {{ plan.unnumbered.length }} without a number, marked for review
      </li>
      <li
        v-if="plan.keptPlaced.length > 0"
        class="pl-5 text-muted-color"
      >
        Keeps {{ pluralize(plan.keptPlaced.length, "measure") }} already on the score
      </li>
    </ul>

    <div
      v-if="hasPlacedMeasures"
      class="flex items-center gap-2"
    >
      <Checkbox
        v-model="replacePlaced"
        input-id="detect-replace-placed"
        binary
      />
      <label
        for="detect-replace-placed"
        class="text-sm"
      >Replace boxes that are already placed</label>
    </div>

    <template v-if="canCreateMeasures">
      <div class="flex items-center gap-2">
        <Checkbox
          v-model="createMissing"
          input-id="detect-create-missing"
          binary
        />
        <label
          for="detect-create-missing"
          class="text-sm"
        >Add measures the song does not have yet</label>
      </div>
      <div
        v-if="createMissing"
        class="flex items-center justify-between gap-2 pl-7"
      >
        <label
          for="detect-beats"
          class="text-sm"
        >Beats per new measure</label>
        <InputNumber
          v-model="beats"
          input-id="detect-beats"
          :min="1"
          :max="32"
          show-buttons
          button-layout="horizontal"
          size="small"
          input-class="w-12 text-center"
        />
      </div>
    </template>
    <span
      v-else
      class="text-xs text-muted-color"
    >The beat map defines the measures of this song, so boxes of other measures stay without a number.</span>

    <span
      v-if="plan.lowConfidence.length > 0 || plan.unnumbered.length > 0"
      class="text-xs text-muted-color"
    >Marked boxes stay marked on the score until you check them.</span>

    <div class="flex justify-end gap-2">
      <Button
        label="Discard"
        severity="secondary"
        size="small"
        text
        @click="detection.discard()"
      />
      <Button
        label="Apply"
        size="small"
        :disabled="!hasMeasureDetectionChanges(plan) || saving"
        :loading="saving"
        @click="apply"
      />
    </div>
  </div>
</template>
