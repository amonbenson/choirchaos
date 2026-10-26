<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Popover from "primevue/popover";
import { computed, ref, useId } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import { findExistingLabels, getUnplacedRuns, type MeasureRun, planAddMeasures } from "@/core/models/measureEditing";
import { parseLabelList } from "@/core/models/measureLabel";
import type Song from "@/core/models/song";
import { getSongSetup, isFileStep, type SetupStep } from "@/core/models/songSetup";

import DuplicateReviewCard from "./DuplicateReviewCard.vue";
import RecordingOverview from "./RecordingOverview.vue";

const props = defineProps<{
  song: Song;
}>();

const emit = defineEmits<{
  openDetails: [];
}>();

const editor = injectMeasureEditor();
const { measures, mode, tool, placeFrom, unnumberedBoxes, reviewItems } = editor;
const { notifyError } = useNotify();
const ids = { checklist: useId(), unplaced: useId() };

const setup = computed(() => getSongSetup(props.song));
const placedCount = computed(() => measures.value.filter(measure => measure.layout).length);
const unplacedRuns = computed(() => getUnplacedRuns(measures.value));
const hasBoxes = computed(() => placedCount.value > 0 || unnumberedBoxes.value.length > 0);
const nextFileStep = computed(() => setup.value.next && isFileStep(setup.value.next.id) ? setup.value.next : undefined);

function describeStep(step: SetupStep): string {
  switch (step.id) {
    case "measures":
      return measures.value.length === 0 ? "No measures yet" : `${placedCount.value} of ${measures.value.length} measures on the score`;
    case "review":
      return reviewItems.value.length === 1 ? "1 box to review" : `${reviewItems.value.length} boxes to review`;
    case "sync": {
      const count = props.song.getWarpMarkers().length;
      return `Audio sync (${count} ${count === 1 ? "sync point" : "sync points"})`;
    }

    default:
      return step.label;
  }
}

function runLabel(run: MeasureRun): string {
  return run.count === 1 ? `Measure ${run.first.label}` : `Measures ${run.first.label} to ${run.last.label}`;
}

const addPopover = ref();
const newMeasures = ref("");
const newMeasureBeats = ref(4);
const parsedNewMeasures = computed(() => parseLabelList(newMeasures.value));
const duplicateMeasures = computed(() => findExistingLabels(measures.value, parsedNewMeasures.value ?? []));

function openAddMeasures(event: Event): void {
  newMeasures.value = "";
  addPopover.value.toggle(event);
}

async function addMeasures(): Promise<void> {
  const labels = parsedNewMeasures.value;
  if (!labels || duplicateMeasures.value.length > 0) {
    return;
  }

  addPopover.value.hide();
  try {
    await editor.apply(planAddMeasures(measures.value, labels, newMeasureBeats.value));
  } catch (error) {
    notifyError("Could not add the measures", error);
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <h3
      :id="ids.checklist"
      class="sr-only"
    >
      Setup checklist
    </h3>
    <ul
      class="flex flex-col gap-1.5"
      :aria-labelledby="ids.checklist"
    >
      <li
        v-for="step in setup.steps"
        :key="step.id"
        class="flex items-center gap-2 text-sm"
        :class="step.done ? '' : 'text-muted-color'"
      >
        <i
          class="pi"
          :class="step.done ? 'pi-check text-primary' : step.id === 'review' ? 'pi-exclamation-circle text-amber-600 dark:text-amber-400' : 'pi-circle'"
          aria-hidden="true"
        />
        <span>{{ describeStep(step) }}<span class="sr-only">{{ step.done ? ", done" : ", open" }}</span></span>
      </li>
      <li
        v-for="hint in setup.hints"
        :key="hint.id"
        class="flex items-center gap-2 text-sm"
      >
        <i
          class="pi pi-info-circle text-muted-color"
          aria-hidden="true"
        />
        {{ hint.label }}
      </li>
    </ul>

    <Button
      v-if="nextFileStep"
      :label="nextFileStep.action"
      icon="pi pi-file-edit"
      severity="secondary"
      size="small"
      class="self-start"
      @click="emit('openDetails')"
    />

    <DuplicateReviewCard :song="song" />

    <div
      v-if="mode === 'audio' || song.pdfFile || hasBoxes"
      class="flex flex-wrap gap-2"
    >
      <Button
        v-if="mode === 'audio'"
        label="Add"
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        aria-haspopup="dialog"
        @click="openAddMeasures"
      />
      <Button
        v-if="song.pdfFile"
        label="Detect"
        icon="pi pi-sparkles"
        severity="secondary"
        size="small"
        @click="editor.detection.start()"
      />
      <Button
        v-if="hasBoxes"
        label="Select all"
        class="mouse:hidden"
        severity="secondary"
        size="small"
        text
        @click="editor.selectAll()"
      />
    </div>

    <span
      v-if="tool === 'draw'"
      class="text-sm"
    >
      Drag a box around one or more measures on the score.
      <template v-if="placeFrom">The next box starts at measure {{ placeFrom }}.</template>
    </span>
    <span
      v-else
      class="text-sm text-muted-color"
    >Click a measure on the score to set how rehearsals play it, mark it or edit its box. Drag over several with the Select tool or Shift. Use the Draw tool to add boxes.</span>

    <div
      v-if="unplacedRuns.length > 0"
      class="flex flex-col"
    >
      <h3
        :id="ids.unplaced"
        class="mb-1 text-sm font-semibold"
      >
        Not on the score
      </h3>
      <ul :aria-labelledby="ids.unplaced">
        <li
          v-for="run in unplacedRuns"
          :key="run.first.id"
          class="flex items-center justify-between gap-2 rounded py-0.5 pl-2 hover:bg-surface-100 dark:hover:bg-surface-800"
        >
          <span class="text-sm">{{ runLabel(run) }}</span>
          <Button
            label="Place"
            size="small"
            severity="secondary"
            text
            :aria-label="`Place ${runLabel(run).toLowerCase()}`"
            @click="editor.startPlacing(run.first.label)"
          />
        </li>
      </ul>
    </div>
    <span
      v-else-if="measures.length === 0 && mode === 'audio'"
      class="text-sm"
    >This song has no measures yet. Draw a box on the score or add them by number.</span>

    <RecordingOverview
      v-if="song.getTimeline().length > 0"
      :song="song"
    />

    <Popover ref="addPopover">
      <form
        class="flex w-72 flex-col gap-3"
        @submit.prevent="addMeasures"
      >
        <div class="flex flex-col gap-1">
          <label
            for="new-measures"
            class="text-sm font-medium"
          >Measures</label>
          <InputText
            id="new-measures"
            v-model="newMeasures"
            placeholder="1..32, 32a"
            :invalid="!!newMeasures && (!parsedNewMeasures || duplicateMeasures.length > 0)"
            autofocus
            fluid
          />
          <Message
            v-if="duplicateMeasures.length > 0"
            severity="error"
            size="small"
            variant="simple"
          >
            Already exists: {{ duplicateMeasures.slice(0, 5).join(", ") }}
          </Message>
          <span
            v-else
            class="text-xs text-muted-color"
          >Single numbers like 4 or 4a, ranges like 1..32, separated by commas.</span>
        </div>
        <div class="flex items-center justify-between gap-2">
          <label
            for="new-measure-beats"
            class="text-sm font-medium"
          >Beats per measure</label>
          <InputNumber
            v-model="newMeasureBeats"
            input-id="new-measure-beats"
            :min="1"
            :max="32"
            show-buttons
            button-layout="horizontal"
            size="small"
            input-class="w-12 text-center"
          />
        </div>
        <Button
          type="submit"
          :label="parsedNewMeasures ? `Add ${parsedNewMeasures.length} ${parsedNewMeasures.length === 1 ? 'measure' : 'measures'}` : 'Add measures'"
          :disabled="!parsedNewMeasures || duplicateMeasures.length > 0"
          size="small"
        />
      </form>
    </Popover>
  </div>
</template>
