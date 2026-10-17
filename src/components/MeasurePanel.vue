<script setup lang="ts">
import { useEventListener } from "@vueuse/core";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Popover from "primevue/popover";
import { computed, ref } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import Measure from "@/core/models/measure";
import { getUnplacedRuns, type MeasureRun } from "@/core/models/measureEditing";
import type Song from "@/core/models/song";
import { parseMeasureList } from "@/core/utils/numbering";

import MeasureDetectionForm from "./MeasureDetectionForm.vue";
import MeasureNewBoxForm from "./MeasureNewBoxForm.vue";
import MeasureReviewBar from "./MeasureReviewBar.vue";
import MeasureSelectionForm from "./MeasureSelectionForm.vue";
import MeasureUnnumberedForm from "./MeasureUnnumberedForm.vue";

defineProps<{
  song: Song | undefined;
}>();

const editor = injectMeasureEditor();
const { measures, mode, selection, pendingBox, tool, placeFrom, selectedBox, reviewItems, currentReviewItem, detection } = editor;
const { notifyError } = useNotify();

const detecting = computed(() => !!detection.progress.value);

const placedCount = computed(() => measures.value.filter(measure => measure.layout).length);
const unplacedRuns = computed(() => getUnplacedRuns(measures.value));
const showReviewBar = computed(() => !pendingBox.value && reviewItems.value.length > 0
  && (selection.value.length === 0 || !!currentReviewItem.value));

const summary = computed(() => {
  if (detection.running.value) {
    return "Detecting";
  }

  if (detection.plan.value) {
    return "Detection result";
  }

  if (pendingBox.value) {
    return "New box";
  }

  if (selectedBox.value) {
    return "Box without a number";
  }

  if (selection.value.length === 1) {
    return `Measure ${selection.value[0]!.value}`;
  }

  if (selection.value.length > 1) {
    return `${selection.value.length} measures selected`;
  }

  const placed = `${placedCount.value} of ${measures.value.length} placed`;
  return reviewItems.value.length > 0 ? `${placed}, ${reviewItems.value.length} to review` : placed;
});

function runLabel(run: MeasureRun): string {
  return run.count === 1 ? `Measure ${run.first.value}` : `Measures ${run.first.value} to ${run.last.value}`;
}

const addPopover = ref();
const newMeasures = ref("");
const newMeasureBeats = ref(4);
const parsedNewMeasures = computed(() => parseMeasureList(newMeasures.value));
const duplicateMeasures = computed(() => {
  const existing = new Set(measures.value.map(measure => measure.value));
  return (parsedNewMeasures.value ?? []).filter(value => existing.has(value));
});

function openAddMeasures(event: Event): void {
  newMeasures.value = "";
  addPopover.value.toggle(event);
}

const reviewBar = ref<InstanceType<typeof MeasureReviewBar>>();
const selectionForm = ref<InstanceType<typeof MeasureSelectionForm>>();
const unnumberedForm = ref<InstanceType<typeof MeasureUnnumberedForm>>();

const TYPED_CHARACTER = /^[0-9a-z]$/i;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable);
}

function focusNumberField(): void {
  const field = document.getElementById(selectedBox.value ? "box-number" : "measure-number");
  if (field instanceof HTMLInputElement) {
    field.focus();
    field.select();
  }
}

function onReviewKey(event: KeyboardEvent): void {
  if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    if (selectedBox.value) {
      unnumberedForm.value?.place();
    } else {
      reviewBar.value?.confirmCurrent();
    }
  } else if (TYPED_CHARACTER.test(event.key)) {
    // Focusing during keydown lets the browser type the key into the field, replacing its text.
    focusNumberField();
  }
}

// Keys work on the score selection, so they only act while no field has the focus.
useEventListener("keydown", (event: KeyboardEvent) => {
  if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey || detecting.value) {
    return;
  }

  if (event.key === "Delete") {
    if (selectedBox.value) {
      unnumberedForm.value?.remove();
    } else {
      selectionForm.value?.removeBoxes();
    }
  } else if (currentReviewItem.value) {
    onReviewKey(event);
  }
});

async function addMeasures(): Promise<void> {
  const values = parsedNewMeasures.value;
  if (!values || duplicateMeasures.value.length > 0) {
    return;
  }

  addPopover.value.hide();
  try {
    await editor.addMeasures(values.map(value => new Measure(value, newMeasureBeats.value)));
  } catch (error) {
    notifyError("Could not add the measures", error);
  }
}
</script>

<template>
  <div
    class="flex min-h-0 flex-col gap-4"
    data-testid="measure-panel"
  >
    <span
      class="flex-none truncate text-sm font-semibold"
      aria-live="polite"
    >{{ summary }}</span>

    <MeasureDetectionForm
      v-if="detecting"
      class="min-h-0 flex-1 overflow-y-auto"
    />

    <div
      v-else
      class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
    >
      <MeasureReviewBar
        v-if="showReviewBar"
        ref="reviewBar"
      />

      <MeasureNewBoxForm
        v-if="pendingBox"
        :layout="pendingBox"
      />

      <MeasureUnnumberedForm
        v-else-if="selectedBox"
        ref="unnumberedForm"
        :box="selectedBox"
      />

      <MeasureSelectionForm
        v-else-if="selection.length > 0"
        ref="selectionForm"
      />

      <template v-else>
        <div
          v-if="measures.length > 0"
          class="h-1 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700"
        >
          <div
            class="h-full rounded-full bg-primary transition-all"
            :style="{ width: `${placedCount / measures.length * 100}%` }"
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
        >Select boxes on the score to edit them. Use the Draw tool to add boxes.</span>

        <div
          v-if="unplacedRuns.length > 0"
          class="flex flex-col"
        >
          <span class="mb-1 text-sm font-semibold">Not on the score</span>
          <div
            v-for="run in unplacedRuns"
            :key="run.first.value"
            class="flex items-center justify-between gap-2 rounded py-0.5 pl-2 hover:bg-surface-100 dark:hover:bg-surface-800"
          >
            <span class="text-sm">{{ runLabel(run) }}</span>
            <Button
              label="Place"
              size="small"
              severity="secondary"
              text
              :aria-label="`Place ${runLabel(run).toLowerCase()}`"
              @click="editor.startPlacing(run.first.value)"
            />
          </div>
        </div>
        <span
          v-else-if="measures.length > 0"
          class="flex items-center gap-2 text-sm"
        ><i class="pi pi-check text-primary" /> Every measure is on the score.</span>
        <span
          v-else-if="mode === 'audio'"
          class="text-sm"
        >This song has no measures yet. Draw a box on the score or add them by number.</span>
      </template>
    </div>

    <div
      v-if="!detecting && !pendingBox && !selectedBox && selection.length === 0 && (mode === 'audio' || song?.pdfFile)"
      class="flex flex-none gap-2"
    >
      <Button
        v-if="mode === 'audio'"
        label="Add..."
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        @click="openAddMeasures"
      />
      <Button
        v-if="song?.pdfFile"
        label="Detect..."
        icon="pi pi-sparkles"
        severity="secondary"
        size="small"
        @click="detection.start()"
      />
    </div>

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
