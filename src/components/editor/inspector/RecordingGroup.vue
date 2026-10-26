<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { computed, ref, useId, watch } from "vue";

import { useRecordingEditor } from "@/composables/useRecordingEditor";
import { formatLocation, formatOccurrence } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import type { SelectedRun } from "@/core/models/measureSelection";
import { findBackToBackPasses, MAX_RECORDED_COUNT, setJump, setRecordedCount } from "@/core/models/recording";
import type Song from "@/core/models/song";

import InspectorGroup from "./InspectorGroup.vue";

// Stepping through the count saves once the clicks stop, not on every click.
const COUNT_SAVE_DELAY_MS = 400;

const props = defineProps<{
  song: Song;
  run: SelectedRun;
}>();

const editor = useRecordingEditor(() => props.song);
const { saving, status } = editor;
const ids = { count: useId(), countHint: useId(), jump: useId() };

const timeline = computed(() => props.song.getTimeline());
const editable = computed(() => props.song.isRecordingEditable());
const range = computed(() => ({ from: timeline.value[props.run.first]!, to: timeline.value[props.run.last]! }));
const recorded = computed(() => findBackToBackPasses(timeline.value, range.value).length);
const after = computed(() => range.value.to);
const next = computed(() => timeline.value[props.run.last + 1]);

const label = (id: MeasureId): string => props.song.findMeasure(id)?.label ?? "?";
const rangeText = computed(() => range.value.from.measure === range.value.to.measure
  ? label(range.value.from.measure)
  : `${label(range.value.from.measure)} to ${label(range.value.to.measure)}`);
const afterText = computed(() => formatLocation(props.song, after.value));
const nextText = computed(() => next.value ? formatOccurrence(label(next.value.measure), next.value.occurrence) : undefined);

const summary = computed(() => recorded.value === 1 ? "Recorded once" : `Recorded ${recorded.value} times`);
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
  if (to === next.value?.measure) {
    return;
  }

  await editor.setSpans(setJump(props.song.getMeasures(), props.song.getRecording(), after.value, to));
}
</script>

<template>
  <InspectorGroup
    id="recording"
    title="Recording"
    :summary="summary"
  >
    <template v-if="editable">
      <div class="flex items-center justify-between gap-2">
        <label
          :for="ids.count"
          class="text-sm"
        >Recorded</label>
        <div class="flex items-center gap-3">
          <InputNumber
            :model-value="count"
            :input-id="ids.count"
            :min="1"
            :max="MAX_RECORDED_COUNT"
            :disabled="saving"
            show-buttons
            button-layout="horizontal"
            size="small"
            input-class="w-10 text-center"
            :aria-describedby="ids.countHint"
            @update:model-value="onCountChange"
          />
          <span
            class="w-10 text-sm"
            aria-hidden="true"
          >{{ count === 1 ? "time" : "times" }}</span>
        </div>
      </div>
      <span
        :id="ids.countHint"
        class="text-xs text-muted-color"
      >Raise this when the backing track itself plays {{ rangeText }} more than once in a row. Markers and sync points move with their measures.</span>

      <div class="flex items-center justify-between gap-2">
        <span
          :id="ids.jump"
          class="text-sm"
        >After {{ afterText }}, continue at</span>
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
          :aria-labelledby="ids.jump"
          @update:model-value="onJumpChange"
        >
          <template #value="{ value, placeholder }">
            {{ value === next?.measure && nextText ? nextText : value ? label(value) : placeholder }}
          </template>
        </Select>
      </div>
      <span class="text-xs text-muted-color">Pick another measure for endings or a D.S. The recording then plays on from there.</span>
    </template>

    <template v-else>
      <span class="text-sm">{{ summary }}<template v-if="nextText">, then {{ nextText }}</template></span>
      <span class="text-xs text-muted-color">A MIDI song plays its beat map, so its recording cannot be changed here.</span>
    </template>

    <span
      class="text-xs text-muted-color empty:hidden"
      role="status"
    >{{ status }}</span>
  </InspectorGroup>
</template>
