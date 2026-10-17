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
import {
  type ConflictResolution,
  getCommonBeats,
  getReadingOrder,
  isEmptyEdit,
  type MeasureEdit,
  type MeasureEditResult,
  planBeats,
  planDeleteMeasures,
  planRemoveBoxes,
  planRenumber,
} from "@/core/models/measureEditing";

// Stepping through beats saves once the clicks stop, not on every click.
const BEATS_SAVE_DELAY_MS = 400;

const editor = injectMeasureEditor();
const { measures, mode, selection, saving } = editor;
const confirm = useConfirm();
const { notifyError } = useNotify();

const single = computed(() => selection.value.length === 1 ? selection.value[0] : undefined);
const ordered = computed(() => getReadingOrder(selection.value));
const commonBeats = computed(() => getCommonBeats(selection.value));

const number = ref("");
const beats = ref<number | null>(null);
const outcome = ref<Exclude<MeasureEditResult, { status: "ok" }>>();

const selectionKey = computed(() => selection.value.map(measure => `${measure.value}:${measure.beats}`).join(","));

watch(selectionKey, () => {
  number.value = single.value?.value ?? ordered.value[0]?.value ?? "";
  beats.value = commonBeats.value ?? null;
  outcome.value = undefined;
}, { immediate: true });

const unchangedNumber = computed(() => !!single.value && number.value.trim() === single.value.value);

async function apply(edit: MeasureEdit, failure: string): Promise<void> {
  try {
    await editor.apply(edit);
  } catch (error) {
    notifyError(failure, error);
  }
}

async function renumber(resolution?: ConflictResolution): Promise<void> {
  const start = number.value.trim();
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
  if (!isEmptyEdit(result.edit)) {
    await apply(result.edit, "Could not renumber");
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

const boxLabel = computed(() => selection.value.length === 1 ? "Remove box" : "Remove boxes");
const deleteLabel = computed(() => selection.value.length === 1 ? "Delete measure" : "Delete measures");

function removeBoxes(): void {
  apply(planRemoveBoxes(selection.value), "Could not remove the boxes");
}

function deleteMeasures(): void {
  const targets = [...selection.value];
  const names = targets.length === 1 ? `Measure ${targets[0]!.value}` : `${targets.length} measures`;
  confirm.require({
    header: deleteLabel.value,
    message: `${names} will be deleted from the song, together with their sync markers.`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: deleteLabel.value, severity: "danger" },
    accept: () => apply(planDeleteMeasures(targets), "Could not delete the measures"),
  });
}
</script>

<template>
  <div class="flex flex-col gap-4">
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
          Measure {{ outcome.conflict.value }} already has a box.
        </Message>
        <div class="flex flex-wrap gap-2">
          <Button
            v-if="single"
            :label="`Swap with measure ${outcome.conflict.value}`"
            severity="secondary"
            size="small"
            :disabled="saving"
            @click="renumber('swap')"
          />
          <Button
            :label="`Shift ${outcome.conflict.value} and later by +${selection.length}`"
            severity="secondary"
            size="small"
            :disabled="saving"
            @click="renumber('shift')"
          />
        </div>
      </div>
    </form>

    <div class="flex items-center justify-between gap-4">
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
        v-if="mode === 'audio'"
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
