<script setup lang="ts">
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import { computed, ref, watch } from "vue";

import { formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import { countOccurrences, isSameLocation, type Location, validateLocation } from "@/core/models/recording";
import type Song from "@/core/models/song";

// The measure by label, a 1-based beat and, for measures the recording plays more than once, which
// time it plays. The fields are read as a whole on commit and validated like the model does, and the
// model only ever holds a valid location.

const props = defineProps<{
  song: Song;
  /** Names the fields, e.g. "marker A" gives "Measure of marker A". */
  subject: string;
  /** The element that explains `error`, rendered by the parent so it can span the whole row. */
  errorId: string;
  /** Marks the fields invalid for a problem the parent found, such as an overlap. */
  invalid?: boolean;
}>();

const location = defineModel<Location>({ required: true });
const error = defineModel<string | undefined>("error");

const emit = defineEmits<{
  commit: [];
  /** Escape was pressed, after the fields were reset to the model. */
  cancel: [];
}>();

const measureLabel = ref("");
const beat = ref<number | null>(1);
const occurrence = ref(1);

const typedMeasure = computed(() => props.song.findMeasureByLabel(measureLabel.value.trim()));
const occurrenceCount = computed(() => typedMeasure.value ? countOccurrences(props.song.getTimeline(), typedMeasure.value.id) : 0);
const occurrenceOptions = computed(() => Array.from({ length: occurrenceCount.value }, (_, i) => ({
  label: formatTimes(i + 1),
  value: i + 1,
})));

const isInvalid = computed(() => !!error.value || props.invalid);
const describedBy = computed(() => isInvalid.value ? props.errorId : undefined);

watch(occurrenceCount, (count) => {
  if (count > 0 && occurrence.value > count) {
    occurrence.value = 1;
  }
});

function reset(): void {
  measureLabel.value = props.song.findMeasure(location.value.measure)?.label ?? "";
  beat.value = location.value.beat + 1;
  occurrence.value = location.value.occurrence;
  error.value = undefined;
}

watch(location, reset, { immediate: true });

function read(): Location | undefined {
  const measure = typedMeasure.value;
  if (!measure) {
    error.value = `This song has no measure ${measureLabel.value.trim()}.`;
    return undefined;
  }

  const typed = {
    measure: measure.id,
    beat: (beat.value ?? 1) - 1,
    occurrence: occurrence.value <= occurrenceCount.value ? occurrence.value : 1,
  };
  const reason = validateLocation(props.song.getMeasures(), props.song.getTimeline(), typed);
  error.value = reason;
  return reason ? undefined : typed;
}

function cancel(): void {
  reset();
  emit("cancel");
}

function commit(): void {
  const typed = read();
  if (!typed) {
    return;
  }

  if (!isSameLocation(typed, location.value)) {
    location.value = typed;
  }

  emit("commit");
}

defineExpose({ reset });
</script>

<template>
  <div
    class="flex flex-none items-center gap-1"
    data-location-input
  >
    <InputText
      v-model="measureLabel"
      class="w-14 font-mono"
      size="small"
      :invalid="isInvalid"
      :aria-label="`Measure of ${subject}`"
      :aria-describedby="describedBy"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.esc="cancel"
    />
    <span aria-hidden="true">.</span>
    <InputNumber
      v-model="beat"
      class="w-10 flex-none"
      input-class="w-full font-mono"
      size="small"
      :min="1"
      :max="typedMeasure?.beats"
      :use-grouping="false"
      :invalid="isInvalid"
      :aria-label="`Beat of ${subject}`"
      :aria-describedby="describedBy"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.esc="cancel"
    />
    <Select
      v-if="occurrenceCount > 1"
      v-model="occurrence"
      class="w-22 flex-none"
      size="small"
      :options="occurrenceOptions"
      option-label="label"
      option-value="value"
      :aria-label="`Occurrence of ${subject}`"
      @change="commit"
    >
      <template #value="{ value }">
        {{ formatOrdinal(value) }}
      </template>
    </Select>
  </div>
</template>
