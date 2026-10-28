<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import Select from "primevue/select";
import { computed, ref, useId, watch } from "vue";

import FieldRow from "@/components/base/FieldRow.vue";
import StepperInput from "@/components/base/StepperInput.vue";
import { useRecordingEditor } from "@/composables/useRecordingEditor";
import { formatLocation, formatOccurrence } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { findBackToBackPasses, MAX_RECORDED_COUNT, type RecordedPass, setJump, setRecordedCount } from "@/core/models/recording";
import type Song from "@/core/models/song";

import InspectorSection from "./InspectorSection.vue";

// Stepping through the count saves once the clicks stop, not on every click.
const COUNT_SAVE_DELAY_MS = 400;

const props = defineProps<{
  song: Song;
  run: RecordedPass;
}>();

const editor = useRecordingEditor(() => props.song);
const { saving, status } = editor;
const countHintId = useId();

const timeline = computed(() => props.song.getTimeline());
const range = computed(() => ({ from: timeline.value[props.run.first]!, to: timeline.value[props.run.last]! }));
const recorded = computed(() => findBackToBackPasses(timeline.value, range.value).length);
const next = computed(() => timeline.value[props.run.last + 1]);

const label = (id: MeasureId): string => props.song.findMeasure(id)?.label ?? "?";
const afterText = computed(() => formatLocation(props.song, range.value.to));
const nextText = computed(() => next.value ? formatOccurrence(label(next.value.measure), next.value.occurrence) : undefined);
const targets = computed(() => props.song.getMeasures().map(measure => ({ value: measure.id, label: measure.label })));

const count = ref(recorded.value);
watch(recorded, (value) => {
  count.value = value;
});

async function saveCount(value: number): Promise<void> {
  const spans = setRecordedCount(props.song.getMeasures(), props.song.getRecording(), range.value, value);
  if (!await editor.setSpans(spans)) {
    count.value = recorded.value;
  }
}

const saveCountLater = useDebounceFn(saveCount, COUNT_SAVE_DELAY_MS);

function onCountChange(value: number | null): void {
  if (value === null) {
    return;
  }

  count.value = value;
  if (value !== recorded.value) {
    saveCountLater(value);
  }
}

async function onJumpChange(to: MeasureId): Promise<void> {
  if (to !== next.value?.measure) {
    await editor.setSpans(setJump(props.song.getMeasures(), props.song.getRecording(), range.value.to, to));
  }
}
</script>

<template>
  <InspectorSection title="Recording">
    <FieldRow
      v-slot="{ id }"
      label="Recorded"
    >
      <div class="flex items-center gap-3">
        <StepperInput
          :model-value="count"
          :input-id="id"
          :min="1"
          :max="MAX_RECORDED_COUNT"
          :disabled="saving"
          :aria-describedby="countHintId"
          @update:model-value="onCountChange"
        />
        <span
          class="w-10 text-sm"
          aria-hidden="true"
        >{{ count === 1 ? "time" : "times" }}</span>
      </div>
    </FieldRow>
    <span
      :id="countHintId"
      class="text-xs text-muted-color"
    >Raise this when the backing track itself plays these measures more than once in a row.</span>

    <FieldRow
      v-slot="{ id, labelId }"
      :label="`After ${afterText}, continue at`"
    >
      <Select
        :model-value="next?.measure"
        class="w-36 shrink-0"
        size="small"
        :options="targets"
        option-label="label"
        option-value="value"
        placeholder="End"
        filter
        auto-filter-focus
        :disabled="saving"
        :label-id="id"
        :aria-labelledby="labelId"
        @update:model-value="onJumpChange"
      >
        <template #value="{ value, placeholder }">
          {{ value === next?.measure && nextText ? nextText : value ? label(value) : placeholder }}
        </template>
      </Select>
    </FieldRow>

    <span
      class="text-xs text-muted-color empty:hidden"
      role="status"
    >{{ status }}</span>
  </InspectorSection>
</template>
