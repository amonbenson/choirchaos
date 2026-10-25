<script lang="ts">
import { formatOccurrence } from "@/core/models/locationFormat";
import { findRecordedPasses, type Location } from "@/core/models/recording";
import type { Section, SectionKind, VampOut, VampVocals } from "@/core/models/sections";
import type Song from "@/core/models/song";

export const SECTION_KIND_NAMES: Record<SectionKind, string> = { cut: "Cut", repeat: "Repeat", vamp: "Vamp" };

function describeLocation(song: Song, { measure, occurrence }: Location): string {
  return formatOccurrence(song.findMeasure(measure)?.label ?? "?", occurrence);
}

/**
 * "Vamp from 10 to 11, 2nd time", which names the section's fields and its row. A first occurrence goes
 * unnamed, since the recorded passes that follow it are part of the section.
 */
export function describeSection(song: Song, section: Section): string {
  return `${SECTION_KIND_NAMES[section.kind]} from ${describeLocation(song, section.from)} to ${describeLocation(song, section.to)}`;
}

export function describeRecordedPasses(song: Song, section: Section): string {
  const count = findRecordedPasses(song.getTimeline(), section).length;
  return count === 1 ? "Recorded once" : `Recorded ${count} times`;
}

const KIND_OPTIONS = (Object.entries(SECTION_KIND_NAMES) as [SectionKind, string][]).map(([value, label]) => ({ value, label }));

const OUT_OPTIONS: { value: VampOut; label: string }[] = [
  { value: "onEnd", label: "At the end" },
  { value: "anyBar", label: "At the next bar" },
  { value: "anyBeat", label: "At the next beat" },
];

const VOCALS_OPTIONS: { value: VampVocals; label: string }[] = [
  { value: "all", label: "Every pass" },
  { value: "first", label: "First pass" },
  { value: "last", label: "Last pass" },
  { value: "split", label: "First and last pass" },
];
</script>

<script setup lang="ts">
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Select from "primevue/select";
import { computed, ref, useId, useTemplateRef, watch } from "vue";

import { isSameLocation } from "@/core/models/recording";
import { createSection, UNTIL_RELEASED, validateSection, validateSections } from "@/core/models/sections";

import LocationInput from "./LocationInput.vue";

const props = defineProps<{
  song: Song;
  section: Section;
  /** Where the section is in `song.getSections()`, so validation can replace it there. */
  index: number;
  active: boolean;
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  update: [section: Section];
  remove: [];
}>();

const row = ref<HTMLElement>();
const fromInput = useTemplateRef<InstanceType<typeof LocationInput>>("fromInput");
const toInput = useTemplateRef<InstanceType<typeof LocationInput>>("toInput");
const ids = { error: useId(), passes: useId(), untilReleased: useId() };

const kind = ref<SectionKind>(props.section.kind);
const from = ref<Location>(props.section.from);
const to = ref<Location>(props.section.to);
const passes = ref<number | null>(null);
const out = ref<VampOut>("onEnd");
const vocals = ref<VampVocals>("all");
const fromError = ref<string>();
const toError = ref<string>();
const sectionError = ref<string>();

const description = computed(() => describeSection(props.song, props.section));
const subject = computed(() => description.value.charAt(0).toLowerCase() + description.value.slice(1));
const recordedPasses = computed(() => describeRecordedPasses(props.song, props.section));
const errors = computed(() => [fromError.value, toError.value, sectionError.value].filter(Boolean));
const isUntilReleased = computed(() => kind.value === "vamp" && passes.value === UNTIL_RELEASED);

function fill(section: Section): void {
  kind.value = section.kind;
  passes.value = section.kind === "cut" ? null : section.passes;
  out.value = section.kind === "vamp" ? section.out : "onEnd";
  vocals.value = section.kind === "vamp" ? section.vocals : "all";
}

function reset(): void {
  from.value = props.section.from;
  to.value = props.section.to;
  fill(props.section);
  sectionError.value = undefined;
  fromInput.value?.reset();
  toInput.value?.reset();
}

watch(() => props.section, reset, { immediate: true });

function build(): Section {
  const count = passes.value ?? Number.NaN;
  switch (kind.value) {
    case "cut":
      return { kind: "cut", from: from.value, to: to.value };
    case "repeat":
      return { kind: "repeat", from: from.value, to: to.value, passes: count };
    case "vamp":
      return { kind: "vamp", from: from.value, to: to.value, passes: count, out: out.value, vocals: vocals.value };
  }
}

function isSameSection(a: Section, b: Section): boolean {
  return a.kind === b.kind
    && isSameLocation(a.from, b.from)
    && isSameLocation(a.to, b.to)
    && (a.kind === "cut" || (b.kind !== "cut" && a.passes === b.passes))
    && (a.kind !== "vamp" || (b.kind === "vamp" && a.out === b.out && a.vocals === b.vocals));
}

function validate(section: Section): string | undefined {
  const measures = props.song.getMeasures();
  const timeline = props.song.getTimeline();
  const sections = props.song.getSections().map((existing, i) => i === props.index ? section : existing);
  return validateSection(measures, timeline, section) ?? validateSections(measures, timeline, sections)[0]?.reason;
}

function commit(): void {
  if (fromError.value || toError.value) {
    return;
  }

  const section = build();
  sectionError.value = validate(section);
  if (!sectionError.value && !isSameSection(section, props.section)) {
    emit("update", section);
  }
}

function changeKind(): void {
  fill(createSection(kind.value, from.value, to.value));
  commit();
}

// A limited vamp starts at the passes the recording has, so it plays as recorded until changed.
function changeUntilReleased(untilReleased: boolean): void {
  const recorded = findRecordedPasses(props.song.getTimeline(), build()).length;
  passes.value = untilReleased ? UNTIL_RELEASED : Math.max(recorded, 1);
  commit();
}

watch(() => props.autofocus, (autofocus) => {
  if (!autofocus) {
    return;
  }

  const input = row.value?.querySelector<HTMLInputElement>("[data-location-input] input");
  input?.focus();
  input?.select();
}, { immediate: true, flush: "post" });
</script>

<template>
  <div
    ref="row"
    role="group"
    :aria-label="description"
    class="flex flex-col gap-2 border-l-2 pl-2 transition-colors"
    :class="active ? 'border-primary' : 'border-transparent'"
  >
    <div class="flex items-center gap-2">
      <Select
        v-model="kind"
        class="w-28 flex-none"
        size="small"
        :options="KIND_OPTIONS"
        option-label="label"
        option-value="value"
        :aria-label="`Kind of ${subject}`"
        @change="changeKind"
      />
      <span class="min-w-0 flex-1 truncate text-sm text-muted-color">{{ recordedPasses }}</span>
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

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex items-center gap-2">
        <span
          class="w-10 text-sm"
          aria-hidden="true"
        >Start</span>
        <LocationInput
          ref="fromInput"
          v-model="from"
          v-model:error="fromError"
          :song="song"
          :subject="`start of ${subject}`"
          :error-id="ids.error"
          :invalid="!!sectionError"
          @commit="commit"
          @cancel="reset"
        />
      </div>
      <div class="flex items-center gap-2">
        <span
          class="w-10 text-sm"
          aria-hidden="true"
        >End</span>
        <LocationInput
          ref="toInput"
          v-model="to"
          v-model:error="toError"
          :song="song"
          :subject="`end of ${subject}`"
          :error-id="ids.error"
          :invalid="!!sectionError"
          @commit="commit"
          @cancel="reset"
        />
      </div>
    </div>

    <div
      v-if="kind !== 'cut'"
      class="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <div
        v-if="!isUntilReleased"
        class="flex items-center gap-2"
      >
        <label
          :for="ids.passes"
          class="w-10 text-sm"
        >Passes</label>
        <InputNumber
          v-model="passes"
          :input-id="ids.passes"
          class="w-16 flex-none"
          input-class="w-full font-mono"
          size="small"
          :min="1"
          :use-grouping="false"
          :invalid="!!sectionError"
          :aria-label="`Passes of ${subject}`"
          :aria-describedby="sectionError ? ids.error : undefined"
          @blur="commit"
          @keydown.enter="commit"
          @keydown.esc="reset"
        />
      </div>
      <div
        v-if="kind === 'vamp'"
        class="flex items-center gap-2"
      >
        <Checkbox
          :model-value="isUntilReleased"
          :input-id="ids.untilReleased"
          binary
          :aria-label="`Until released, ${subject}`"
          @update:model-value="changeUntilReleased"
        />
        <label
          :for="ids.untilReleased"
          class="text-sm"
        >Until released</label>
      </div>
    </div>

    <div
      v-if="kind === 'vamp'"
      class="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <div class="flex items-center gap-2">
        <span
          class="w-10 text-sm"
          aria-hidden="true"
        >Exit</span>
        <Select
          v-model="out"
          class="w-40 flex-none"
          size="small"
          :options="OUT_OPTIONS"
          option-label="label"
          option-value="value"
          :aria-label="`Exit of ${subject}`"
          @change="commit"
        />
      </div>
      <div class="flex items-center gap-2">
        <span
          class="w-10 text-sm"
          aria-hidden="true"
        >Vocals</span>
        <Select
          v-model="vocals"
          class="w-40 flex-none"
          size="small"
          :options="VOCALS_OPTIONS"
          option-label="label"
          option-value="value"
          :aria-label="`Vocals of ${subject}`"
          @change="commit"
        />
      </div>
    </div>

    <Message
      v-if="errors.length > 0"
      :id="ids.error"
      severity="error"
      size="small"
      variant="simple"
    >
      <span
        v-for="error in errors"
        :key="error"
        class="block"
      >{{ error }}</span>
    </Message>
  </div>
</template>
