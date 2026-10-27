<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { useConfirm } from "primevue/useconfirm";
import { computed, ref, useId, watch } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import { formatSectionName } from "@/core/models/scoreOverlays";
import {
  createSection,
  getSectionRun,
  replaceSections,
  type Section,
  type SectionKind,
  validateSections,
  type VampOut,
  type VampVocals,
  withRun,
} from "@/core/models/sections";
import type Song from "@/core/models/song";

const KIND_OPTIONS: { value: SectionKind; label: string }[] = [
  { value: "repeat", label: "Repeat" },
  { value: "vamp", label: "Vamp" },
  { value: "cut", label: "Cut" },
];

const OUT_OPTIONS: { value: VampOut; label: string }[] = [
  { value: "onEnd", label: "At the end" },
  { value: "anyBar", label: "Any measure" },
  { value: "anyBeat", label: "Any beat" },
];

const VOCALS_OPTIONS: { value: VampVocals; label: string }[] = [
  { value: "all", label: "Every pass" },
  { value: "first", label: "First pass" },
  { value: "last", label: "Last pass" },
  { value: "split", label: "First and last pass" },
];

// Stepping through passes saves once the clicks stop, not on every click.
const PASSES_SAVE_DELAY_MS = 400;

const props = defineProps<{
  song: Song;
  section: Section;
}>();

const selection = injectEditorSelection();
const { notifyError } = useNotify();
const confirm = useConfirm();
const ids = { passes: useId(), out: useId(), vocals: useId(), error: useId() };

const measures = computed(() => props.song.getMeasures());
const timeline = computed(() => props.song.getTimeline());
const name = computed(() => formatSectionName(measures.value, props.section));

const error = ref<string>();
const passes = ref<number | null>(null);

watch(() => props.section, (section) => {
  passes.value = section.kind === "repeat" ? section.passes : null;
  error.value = undefined;
}, { immediate: true });

/** The new section list is checked as a whole, so an invalid change is explained instead of saved. */
async function replace(next: Section | undefined): Promise<void> {
  const sections = replaceSections(props.song.getSections(), [props.section], next);
  const [issue] = validateSections(measures.value, timeline.value, sections);
  error.value = issue?.reason;
  if (issue) {
    return;
  }

  try {
    await props.song.editLayers({ sections });
    selection.select(next ? { kind: "section", from: next.from } : { kind: "none" });
  } catch (failure) {
    notifyError("Could not save the section", failure);
  }
}

/** A section always covers whole measures, so a stored one that starts or ends mid-measure snaps when edited. */
function snapped(next: Section): Section {
  const run = getSectionRun(timeline.value, props.section);
  return run ? withRun(measures.value, timeline.value, next, run) : next;
}

function changeKind(kind: SectionKind): void {
  if (kind !== props.section.kind) {
    replace(snapped(createSection(kind, props.section.from, props.section.to)));
  }
}

function update(change: Partial<Section>): void {
  replace(snapped({ ...props.section, ...change } as Section));
}

const savePasses = useDebounceFn((value: number) => update({ passes: value }), PASSES_SAVE_DELAY_MS);

function onPassesChange(value: number | null): void {
  passes.value = value;
  if (value !== null && props.section.kind === "repeat" && value !== props.section.passes) {
    savePasses(value);
  }
}

function remove(): void {
  const subject = name.value.charAt(0).toLowerCase() + name.value.slice(1);
  confirm.require({
    header: "Remove section",
    message: `Remove ${subject}? These measures will play as recorded.`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Remove", severity: "danger" },
    accept: () => replace(undefined),
  });
}

defineExpose({ remove });
</script>

<template>
  <div class="flex flex-col gap-4">
    <SelectButton
      :model-value="section.kind"
      class="w-full"
      :options="KIND_OPTIONS"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      aria-label="Kind"
      size="small"
      :pt="{ pcToggleButton: { root: 'flex-1 px-1' } }"
      @update:model-value="changeKind"
    />

    <div
      v-if="section.kind === 'repeat'"
      class="flex items-center justify-between gap-2"
    >
      <label
        :for="ids.passes"
        class="text-sm"
      >Passes</label>
      <InputNumber
        :model-value="passes"
        :input-id="ids.passes"
        :min="1"
        :max="99"
        show-buttons
        button-layout="horizontal"
        size="small"
        input-class="w-10 text-center"
        :invalid="!!error"
        :aria-describedby="error ? ids.error : undefined"
        @update:model-value="onPassesChange"
      />
    </div>

    <template v-if="section.kind === 'vamp'">
      <div class="flex items-center justify-between gap-2">
        <span
          :id="ids.out"
          class="text-sm"
        >Out</span>
        <Select
          :model-value="section.out"
          class="w-48"
          size="small"
          :options="OUT_OPTIONS"
          option-label="label"
          option-value="value"
          :aria-labelledby="ids.out"
          @update:model-value="update({ out: $event })"
        />
      </div>
      <div class="flex items-center justify-between gap-2">
        <span
          :id="ids.vocals"
          class="text-sm"
        >Vocals</span>
        <Select
          :model-value="section.vocals"
          class="w-48"
          size="small"
          :options="VOCALS_OPTIONS"
          option-label="label"
          option-value="value"
          :aria-labelledby="ids.vocals"
          @update:model-value="update({ vocals: $event })"
        />
      </div>
    </template>

    <Message
      v-if="error"
      :id="ids.error"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ error }}
    </Message>

    <span class="text-xs text-muted-color">Drag the handles at the ends of the section on the score to change its range.</span>

    <Button
      label="Remove section"
      icon="pi pi-trash"
      severity="danger"
      size="small"
      text
      class="self-start"
      @click="remove"
    />
  </div>
</template>
