<script lang="ts">
import { countOccurrences, type Location } from "@/core/models/recording";
import type Song from "@/core/models/song";

const ORDINAL_SUFFIXES: Record<string, string> = { one: "st", two: "nd", few: "rd", other: "th" };
const ordinalRules = new Intl.PluralRules("en-US", { type: "ordinal" });

export function formatOrdinal(value: number): string {
  return `${value}${ORDINAL_SUFFIXES[ordinalRules.select(value)]}`;
}

export function formatOccurrence(occurrence: number): string {
  return `${formatOrdinal(occurrence)} time`;
}

/** "12", or "12, 2nd time" for a measure the recording plays more than once. */
export function formatLocation(song: Song, location: Location): string {
  const label = song.findMeasure(location.measure)?.label ?? "?";
  return countOccurrences(song.getTimeline(), location.measure) > 1
    ? `${label}, ${formatOccurrence(location.occurrence)}`
    : label;
}
</script>

<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import Select from "primevue/select";
import { computed, ref, useId, watch } from "vue";

import type { Marker } from "@/core/models/markers";
import { isSameLocation, validateLocation } from "@/core/models/recording";

const props = defineProps<{
  song: Song;
  marker: Marker;
  active: boolean;
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  update: [at: Location, text: string];
  remove: [];
}>();

const row = ref<HTMLElement>();
const name = ref("");

// Location input: the measure by label, a 1-based beat and, for measures the recording plays more
// than once, which time it plays. It is read as a whole on commit and validated like the model does.

const subject = computed(() => `marker ${props.marker.text}`);
const measureLabel = ref("");
const beat = ref<number | null>(1);
const occurrence = ref(1);
const locationError = ref<string>();
const locationErrorId = useId();

const typedMeasure = computed(() => props.song.findMeasureByLabel(measureLabel.value.trim()));
const occurrenceCount = computed(() => typedMeasure.value ? countOccurrences(props.song.getTimeline(), typedMeasure.value.id) : 0);
const occurrenceOptions = computed(() => Array.from({ length: occurrenceCount.value }, (_, i) => ({
  label: formatOccurrence(i + 1),
  value: i + 1,
})));

watch(occurrenceCount, (count) => {
  if (count > 0 && occurrence.value > count) {
    occurrence.value = 1;
  }
});

function resetLocation(location: Location): void {
  measureLabel.value = props.song.findMeasure(location.measure)?.label ?? "";
  beat.value = location.beat + 1;
  occurrence.value = location.occurrence;
  locationError.value = undefined;
}

function readLocation(): Location | undefined {
  const measure = typedMeasure.value;
  if (!measure) {
    locationError.value = `This song has no measure ${measureLabel.value.trim()}.`;
    return undefined;
  }

  const location = {
    measure: measure.id,
    beat: (beat.value ?? 1) - 1,
    occurrence: occurrence.value <= occurrenceCount.value ? occurrence.value : 1,
  };
  locationError.value = validateLocation(props.song.getMeasures(), props.song.getTimeline(), location);
  return locationError.value ? undefined : location;
}

function reset(): void {
  resetLocation(props.marker.at);
  name.value = props.marker.text;
}

watch(() => [props.marker.at, props.marker.text], reset, { immediate: true });

function commit(): void {
  const at = readLocation();
  if (!at) {
    return;
  }

  const text = name.value.trim();
  if (!text) {
    name.value = props.marker.text;
    return;
  }

  if (!isSameLocation(at, props.marker.at) || text !== props.marker.text) {
    emit("update", at, text);
  }
}

// The row of a new marker renders before its save finishes, which is when it learns to take the focus.
watch(() => props.autofocus, (autofocus) => {
  if (!autofocus) {
    return;
  }

  const input = row.value?.querySelector<HTMLInputElement>("[data-marker-name]");
  input?.focus();
  input?.select();
}, { immediate: true, flush: "post" });
</script>

<template>
  <div
    ref="row"
    class="flex flex-col gap-1 border-l-2 pl-2 transition-colors"
    :class="active ? 'border-primary' : 'border-transparent'"
  >
    <div class="flex flex-wrap items-center gap-2">
      <div
        class="flex flex-none items-center gap-1"
        data-location-input
      >
        <InputText
          v-model="measureLabel"
          class="w-14 font-mono"
          size="small"
          :invalid="!!locationError"
          :aria-label="`Measure of ${subject}`"
          :aria-describedby="locationError ? locationErrorId : undefined"
          @blur="commit"
          @keydown.enter="commit"
          @keydown.esc="reset"
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
          :invalid="!!locationError"
          :aria-label="`Beat of ${subject}`"
          :aria-describedby="locationError ? locationErrorId : undefined"
          @blur="commit"
          @keydown.enter="commit"
          @keydown.esc="reset"
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
      <div class="flex min-w-24 flex-1 items-center gap-2">
        <InputText
          v-model="name"
          data-marker-name
          class="min-w-0 flex-1"
          size="small"
          :aria-label="`Name of ${subject}`"
          @blur="commit"
          @keydown.enter="commit"
          @keydown.esc="reset"
        />
        <Button
          icon="pi pi-trash"
          severity="secondary"
          size="small"
          :aria-label="`Delete ${subject}`"
          text
          rounded
          @click="emit('remove')"
        />
      </div>
    </div>
    <Message
      v-if="locationError"
      :id="locationErrorId"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ locationError }}
    </Message>
  </div>
</template>
