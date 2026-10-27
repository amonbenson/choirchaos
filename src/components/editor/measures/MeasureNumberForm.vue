<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { computed, ref, watch } from "vue";

import FieldRow from "@/components/base/FieldRow.vue";
import StepperInput from "@/components/base/StepperInput.vue";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import type Measure from "@/core/models/measure";
import { isEmptyMeasureEdit } from "@/core/models/measure";
import { type ConflictResolution, getCommonBeats, type MeasureEditResult, planBeats, type PlannedEdit, planRenumber } from "@/core/models/measureEditing";
import { planConfirm } from "@/core/models/measureReview";

// Stepping through beats saves once the clicks stop, not on every click.
const BEATS_SAVE_DELAY_MS = 400;

const props = defineProps<{
  /** The selected measures in reading order. */
  measures: Measure[];
}>();

const editor = injectMeasureEditor();
const { mode, saving, currentReviewItem } = editor;
const { notifyError } = useNotify();

const single = computed(() => props.measures.length === 1 ? props.measures[0] : undefined);
const commonBeats = computed(() => getCommonBeats(props.measures));

const number = ref("");
const beats = ref<number | null>(null);
const outcome = ref<Exclude<MeasureEditResult, { status: "ok" }>>();

const selectionKey = computed(() => props.measures.map(measure => `${measure.id}:${measure.label}:${measure.beats}`).join(","));

watch(selectionKey, () => {
  number.value = props.measures[0]?.label ?? "";
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

// Inside the review queue, fixing a measure moves on to the next one to check.
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
    await resolve(planConfirm(props.measures), "Could not confirm the measure");
    return;
  }

  if (!start || unchangedNumber.value) {
    outcome.value = undefined;
    return;
  }

  const result = planRenumber(editor.measures.value, props.measures, start, mode.value, resolution);
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
    saveBeats(value, [...props.measures]);
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <form
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
          Measure {{ outcome.conflict.label }} is already on the score.
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
            :label="`Shift ${outcome.conflict.label} and later by +${measures.length}`"
            severity="secondary"
            size="small"
            :disabled="saving"
            @click="renumber('shift')"
          />
        </div>
      </div>
    </form>

    <FieldRow
      v-slot="{ id }"
      label="Beats"
      input-id="measure-beats"
    >
      <StepperInput
        v-if="mode === 'audio'"
        :model-value="beats"
        :input-id="id"
        :min="1"
        :max="32"
        placeholder="Mixed"
        @update:model-value="onBeatsChange"
      />
      <span
        v-else
        class="text-sm text-muted-color"
      >{{ commonBeats ?? "Mixed" }}, from the beat map</span>
    </FieldRow>
  </div>
</template>
