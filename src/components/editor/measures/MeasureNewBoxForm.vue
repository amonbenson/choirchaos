<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import { computed, ref, watch } from "vue";

import StepperInput from "@/components/base/StepperInput.vue";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import type { MeasureLayout } from "@/core/models/measure";
import { getDefaultBeats, getDefaultLabel, getPlannedLabels, type MeasureEditResult, planNewBox } from "@/core/models/measureEditing";

const props = defineProps<{
  layout: MeasureLayout;
}>();

const editor = injectMeasureEditor();
const { measures, mode, pendingCount, placeFrom, saving } = editor;
const { notifyError } = useNotify();

const start = ref("");
const beats = ref(4);

watch(() => props.layout, (layout) => {
  start.value = placeFrom.value ?? getDefaultLabel(measures.value, layout, mode.value) ?? "";
  beats.value = getDefaultBeats(measures.value, layout);
}, { immediate: true });

function plan(resolution?: "shift"): MeasureEditResult {
  const options = { count: pendingCount.value, start: start.value.trim(), beats: beats.value };
  return planNewBox(measures.value, props.layout, options, mode.value, resolution);
}

const result = computed(() => plan());
const shiftResult = computed(() => result.value.status === "conflict" ? plan("shift") : undefined);

const placedRange = computed(() => {
  const target = result.value.status === "ok" ? result.value : shiftResult.value;
  if (target?.status !== "ok") {
    return undefined;
  }

  const labels = getPlannedLabels(measures.value, target);
  return labels.length > 1 ? `measures ${labels[0]} to ${labels.at(-1)}` : `measure ${labels[0]}`;
});

async function place(resolution?: "shift"): Promise<void> {
  const planned = resolution ? shiftResult.value : result.value;
  if (planned?.status !== "ok") {
    return;
  }

  try {
    await editor.placePendingBox(planned);
  } catch (error) {
    notifyError("Could not place the measures", error);
  }
}

function cancel(): void {
  editor.pendingBox.value = undefined;
}
</script>

<template>
  <form
    class="flex flex-col gap-4"
    @submit.prevent="place()"
    @keydown.esc="cancel"
  >
    <div class="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-3">
      <label
        for="new-box-count"
        class="text-sm"
      >How many measures</label>
      <StepperInput
        v-model="pendingCount"
        input-id="new-box-count"
        :min="1"
        :max="64"
        :allow-empty="false"
        autofocus
      />

      <label
        for="new-box-start"
        class="text-sm"
      >First number</label>
      <InputText
        id="new-box-start"
        v-model="start"
        class="w-[7.5rem] text-center"
        size="small"
        :invalid="result.status === 'invalid'"
      />

      <template v-if="mode === 'audio'">
        <label
          for="new-box-beats"
          class="text-sm"
        >Beats</label>
        <StepperInput
          v-model="beats"
          input-id="new-box-beats"
          :min="1"
          :max="32"
          :allow-empty="false"
        />
      </template>
    </div>

    <Message
      v-if="result.status === 'invalid'"
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
        :label="`Shift ${result.conflict.label} and later by +${pendingCount}`"
        severity="secondary"
        size="small"
        :disabled="shiftResult?.status !== 'ok' || saving"
        @click="place('shift')"
      />
      <span
        v-if="shiftResult?.status === 'invalid'"
        class="text-xs text-muted-color"
      >{{ shiftResult.reason }}</span>
    </div>
    <span
      v-else-if="placedRange"
      class="text-sm text-muted-color"
    >Places {{ placedRange }}.</span>

    <div class="flex justify-end gap-2">
      <Button
        label="Cancel"
        severity="secondary"
        size="small"
        text
        @click="cancel"
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
