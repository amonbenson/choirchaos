<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { computed, ref, useId, watch } from "vue";

import FieldRow from "@/components/base/FieldRow.vue";
import StepperInput from "@/components/base/StepperInput.vue";
import { useConfirmDestructive } from "@/composables/useConfirmDestructive";
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
import { lowerFirst } from "@/core/utils/text";

import RemoveButton from "./RemoveButton.vue";

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
const confirmDestructive = useConfirmDestructive();
const errorId = useId();

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

async function remove(): Promise<void> {
  const confirmed = await confirmDestructive({
    header: "Remove section",
    message: `Remove ${lowerFirst(name.value)}? These measures will play as recorded.`,
    accept: "Remove",
  });
  if (confirmed) {
    await replace(undefined);
  }
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

    <FieldRow
      v-if="section.kind === 'repeat'"
      v-slot="{ id }"
      label="Passes"
    >
      <StepperInput
        :model-value="passes"
        :input-id="id"
        :min="1"
        :max="99"
        :invalid="!!error"
        :aria-describedby="error ? errorId : undefined"
        @update:model-value="onPassesChange"
      />
    </FieldRow>

    <template v-if="section.kind === 'vamp'">
      <FieldRow
        v-slot="{ id, labelId }"
        label="Out"
      >
        <Select
          :model-value="section.out"
          :label-id="id"
          class="w-48"
          size="small"
          :options="OUT_OPTIONS"
          option-label="label"
          option-value="value"
          :aria-labelledby="labelId"
          @update:model-value="update({ out: $event })"
        />
      </FieldRow>
      <FieldRow
        v-slot="{ id, labelId }"
        label="Vocals"
      >
        <Select
          :model-value="section.vocals"
          :label-id="id"
          class="w-48"
          size="small"
          :options="VOCALS_OPTIONS"
          option-label="label"
          option-value="value"
          :aria-labelledby="labelId"
          @update:model-value="update({ vocals: $event })"
        />
      </FieldRow>
    </template>

    <Message
      v-if="error"
      :id="errorId"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ error }}
    </Message>

    <span class="text-xs text-muted-color">Drag the handles at the ends of the section on the score or the timeline to change its range. On the timeline they reach every pass.</span>

    <RemoveButton
      label="Remove section"
      @click="remove"
    />
  </div>
</template>
