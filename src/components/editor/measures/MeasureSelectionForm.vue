<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { useConfirm } from "primevue/useconfirm";
import { computed, ref, watch } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import type Measure from "@/core/models/measure";
import { isEmptyMeasureEdit } from "@/core/models/measure";
import {
  type ConflictResolution,
  getCommonBeats,
  getReadingOrder,
  type MeasureEditResult,
  planBeats,
  planDeleteMeasures,
  type PlannedEdit,
  planRemoveBoxes,
  planRenumber,
} from "@/core/models/measureEditing";
import { planConfirm } from "@/core/models/measureReview";

// Stepping through beats saves once the clicks stop, not on every click.
const BEATS_SAVE_DELAY_MS = 400;

const editor = injectMeasureEditor();
const { measures, mode, selection, selectedBoxes, unnumberedBoxes, selectionCount, saving, currentReviewItem } = editor;
const confirm = useConfirm();
const { notifyError } = useNotify();

const single = computed(() => selection.value.length === 1 ? selection.value[0] : undefined);
const ordered = computed(() => getReadingOrder(selection.value));
const commonBeats = computed(() => getCommonBeats(selection.value));
// Boxes without a number have no number or beats to edit, so a selection with them can only be removed.
const onlyMeasures = computed(() => selectedBoxes.value.length === 0);

const number = ref("");
const beats = ref<number | null>(null);
const outcome = ref<Exclude<MeasureEditResult, { status: "ok" }>>();

const selectionKey = computed(() => selection.value.map(measure => `${measure.id}:${measure.label}:${measure.beats}`).join(","));

watch(selectionKey, () => {
  number.value = single.value?.label ?? ordered.value[0]?.label ?? "";
  beats.value = commonBeats.value ?? null;
  outcome.value = undefined;
}, { immediate: true });

const unchangedNumber = computed(() => !!single.value && number.value.trim() === single.value.label);

async function apply(planned: PlannedEdit, failure: string): Promise<void> {
  try {
    await editor.apply(planned);
  } catch (error) {
    notifyError(failure, error);
  }
}

// Inside the review queue, fixing a box moves on to the next one to check.
async function resolve(planned: PlannedEdit, failure: string): Promise<void> {
  if (!currentReviewItem.value) {
    await apply(planned, failure);
    return;
  }

  try {
    await editor.resolveReview(planned);
  } catch (error) {
    notifyError(failure, error);
  }
}

async function renumber(resolution?: ConflictResolution): Promise<void> {
  const start = number.value.trim();
  if (saving.value) {
    return;
  }

  if (unchangedNumber.value && currentReviewItem.value?.measure) {
    await resolve(planConfirm(selection.value), "Could not confirm the measure");
    return;
  }

  if (!start || unchangedNumber.value) {
    outcome.value = undefined;
    return;
  }

  const result = planRenumber(measures.value, selection.value, start, mode.value, resolution);
  if (result.status !== "ok") {
    outcome.value = result;
    return;
  }

  outcome.value = undefined;
  if (!isEmptyMeasureEdit(result.edit)) {
    await resolve(result, "Could not renumber");
  }
}

const saveBeats = useDebounceFn(async (value: number, targets: Measure[]) => {
  await apply(planBeats(targets, value), "Could not change the beats");
}, BEATS_SAVE_DELAY_MS);

function onBeatsChange(value: number | null): void {
  beats.value = value;
  if (value !== null && value !== commonBeats.value) {
    saveBeats(value, [...selection.value]);
  }
}

const boxLabel = computed(() => selectionCount.value === 1 ? "Remove box" : "Remove boxes");
const deleteLabel = computed(() => selection.value.length === 1 ? "Delete measure" : "Delete measures");

function removeBoxes(): void {
  resolve(planRemoveBoxes(selection.value, selectedBoxes.value, unnumberedBoxes.value), "Could not remove the boxes");
}

defineExpose({ removeBoxes });

function unnumberedLabel(count: number): string {
  return count === 1 ? "The box without a number" : `The ${count} boxes without a number`;
}

function deleteMeasures(): void {
  const targets = [...selection.value];
  const boxes = [...selectedBoxes.value];
  const names = targets.length === 1 ? `Measure ${targets[0]!.label}` : `${targets.length} measures`;
  const unnumbered = boxes.length === 0 ? "" : ` ${unnumberedLabel(boxes.length)} will be removed too.`;
  confirm.require({
    header: deleteLabel.value,
    message: `${names} will be deleted from the song, together with their sync markers, markers and sections.${unnumbered}`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: deleteLabel.value, severity: "danger" },
    accept: () => apply(planDeleteMeasures(targets, boxes, unnumberedBoxes.value), "Could not delete the measures"),
  });
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <span
      v-if="!onlyMeasures"
      class="text-sm text-muted-color"
    >{{ unnumberedLabel(selectedBoxes.length) }} can only be numbered one at a time.</span>

    <form
      v-if="onlyMeasures"
      class="flex flex-col gap-2"
      @submit.prevent="renumber()"
    >
      <div class="flex items-center justify-between gap-4">
        <label
          for="measure-number"
          class="text-sm"
        >{{ single ? "Number" : "Renumber from" }}</label>
        <div class="flex gap-2">
          <InputText
            id="measure-number"
            v-model="number"
            class="w-[7.5rem] text-center"
            size="small"
            :invalid="outcome?.status === 'invalid'"
            @change="single && renumber()"
          />
          <Button
            v-if="!single"
            type="submit"
            label="Renumber"
            severity="secondary"
            size="small"
            :disabled="saving"
          />
        </div>
      </div>

      <Message
        v-if="outcome?.status === 'invalid'"
        severity="error"
        size="small"
        variant="simple"
      >
        {{ outcome.reason }}
      </Message>
      <div
        v-else-if="outcome?.status === 'conflict'"
        class="flex flex-col items-start gap-2"
      >
        <Message
          severity="warn"
          size="small"
          variant="simple"
        >
          Measure {{ outcome.conflict.label }} already has a box.
        </Message>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="single"
            :label="`Swap with measure ${outcome.conflict.label}`"
            severity="secondary"
            size="small"
            :disabled="saving"
            @click="renumber('swap')"
          />
          <Button
            :label="`Shift ${outcome.conflict.label} and later by +${selection.length}`"
            severity="secondary"
            size="small"
            :disabled="saving"
            @click="renumber('shift')"
          />
        </div>
      </div>
    </form>

    <div
      v-if="onlyMeasures"
      class="flex items-center justify-between gap-4"
    >
      <label
        for="measure-beats"
        class="text-sm"
      >Beats</label>
      <InputNumber
        v-if="mode === 'audio'"
        :model-value="beats"
        input-id="measure-beats"
        :min="1"
        :max="32"
        show-buttons
        button-layout="horizontal"
        size="small"
        input-class="w-12 text-center"
        placeholder="Mixed"
        @update:model-value="onBeatsChange"
      />
      <span
        v-else
        class="text-sm text-muted-color"
      >{{ commonBeats ?? "Mixed" }}, from the beat map</span>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        :label="boxLabel"
        severity="secondary"
        size="small"
        :disabled="saving"
        @click="removeBoxes"
      />
      <Button
        v-if="mode === 'audio' && selection.length > 0"
        :label="deleteLabel"
        icon="pi pi-trash"
        severity="danger"
        size="small"
        text
        :disabled="saving"
        @click="deleteMeasures"
      />
    </div>
  </div>
</template>
