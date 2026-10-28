<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { computed, ref, watch } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import type { MeasureLayout } from "@/core/models/measure";
import { getDefaultLabel, type MeasureEditResult, type PlannedEdit } from "@/core/models/measureEditing";
import { planNumberBox, planRemoveUnnumberedBox } from "@/core/models/measureReview";

const props = defineProps<{
  box: MeasureLayout;
}>();

const editor = injectMeasureEditor();
const { measures, mode, unnumberedBoxes, saving } = editor;
const { notifyError } = useNotify();

const number = ref("");

watch(() => props.box, (box) => {
  number.value = getDefaultLabel(measures.value, box, mode.value) ?? "";
}, { immediate: true });

function plan(resolution?: "shift"): MeasureEditResult {
  return planNumberBox(measures.value, unnumberedBoxes.value, props.box, number.value.trim(), mode.value, resolution);
}

const result = computed(() => plan());
const shiftResult = computed(() => result.value.status === "conflict" ? plan("shift") : undefined);

async function resolve(planned: PlannedEdit, failure: string): Promise<void> {
  if (saving.value) {
    return;
  }

  try {
    await editor.resolveReview(planned);
  } catch (error) {
    notifyError(failure, error);
  }
}

function place(resolution?: "shift"): void {
  const planned = resolution ? shiftResult.value : result.value;
  if (planned?.status === "ok") {
    resolve(planned, "Could not number the box");
  }
}

function remove(): void {
  resolve(planRemoveUnnumberedBox(unnumberedBoxes.value, props.box), "Could not remove the box");
}

defineExpose({ place, remove });
</script>

<template>
  <form
    class="flex flex-col gap-4"
    @submit.prevent="place()"
  >
    <span class="text-sm text-muted-color">The detector could not read the number of this box.</span>

    <div class="flex items-center justify-between gap-4">
      <label
        for="box-number"
        class="text-sm"
      >Number</label>
      <InputText
        id="box-number"
        v-model="number"
        class="w-30 text-center"
        size="small"
        :invalid="!!number.trim() && result.status === 'invalid'"
      />
    </div>

    <Message
      v-if="number.trim() && result.status === 'invalid'"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ result.reason }}
    </Message>
    <div
      v-else-if="result.status === 'conflict'"
      class="flex flex-col items-start gap-2"
    >
      <Message
        severity="warn"
        size="small"
        variant="simple"
      >
        Measure {{ result.conflict.label }} is already on the score.
      </Message>
      <Button
        :label="`Shift ${result.conflict.label} and later by +1`"
        severity="secondary"
        size="small"
        :disabled="shiftResult?.status !== 'ok' || saving"
        @click="place('shift')"
      />
    </div>

    <div class="flex justify-end gap-2">
      <Button
        label="Remove box"
        severity="secondary"
        size="small"
        text
        :disabled="saving"
        @click="remove"
      />
      <Button
        type="submit"
        label="Place"
        size="small"
        :disabled="result.status !== 'ok' || saving"
      />
    </div>
  </form>
</template>
