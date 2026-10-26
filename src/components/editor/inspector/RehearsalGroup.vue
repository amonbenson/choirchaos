<script setup lang="ts">
import { useDebounceFn } from "@vueuse/core";
import Button from "primevue/button";
import Checkbox from "primevue/checkbox";
import InputNumber from "primevue/inputnumber";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { useConfirm } from "primevue/useconfirm";
import { computed, ref, useId, watch } from "vue";

import { SECTION_COLORS } from "@/components/score/sectionColors";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import { formatSectionName, getSectionRun, type SectionMatch, type SelectedRun, toMeasureRange, withRun } from "@/core/models/measureSelection";
import { findRecordedPasses } from "@/core/models/recording";
import { formatSectionChip } from "@/core/models/scoreOverlays";
import {
  createSection,
  type Section,
  type SectionKind,
  UNTIL_RELEASED,
  validateSections,
  type VampOut,
  type VampVocals,
} from "@/core/models/sections";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

import InspectorGroup from "./InspectorGroup.vue";

type Choice = SectionKind | "recorded";

const KIND_OPTIONS: { value: Choice; label: string }[] = [
  { value: "recorded", label: "As recorded" },
  { value: "repeat", label: "Repeat" },
  { value: "vamp", label: "Vamp" },
  { value: "cut", label: "Cut" },
];

const OUT_OPTIONS: { value: VampOut; label: string }[] = [
  { value: "onEnd", label: "At the end" },
  { value: "anyBar", label: "At the next measure" },
  { value: "anyBeat", label: "At the next beat" },
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
  run: SelectedRun;
  matches: SectionMatch[];
}>();

const editor = injectMeasureEditor();
const player = usePlayerStore();
const { notifyError } = useNotify();
const confirm = useConfirm();
const ids = { passes: useId(), untilReleased: useId(), out: useId(), vocals: useId(), error: useId() };

const measures = computed(() => props.song.getMeasures());
const timeline = computed(() => props.song.getTimeline());

/** The section these measures belong to as a whole, which the fields edit. */
const target = computed(() => props.matches.length === 1 && props.matches[0]!.relation !== "overlaps" ? props.matches[0] : undefined);
const overlapping = computed(() => target.value ? [] : props.matches);
const targetName = computed(() => target.value && formatSectionName(measures.value, target.value.section));

/** A new section that waits for the user to replace the sections it overlaps. */
const pending = ref<Section>();
const error = ref<string>();
const passes = ref<number | null>(null);

const section = computed(() => target.value?.section);
const kind = computed<Choice>(() => pending.value?.kind ?? section.value?.kind ?? "recorded");
const isUntilReleased = computed(() => section.value?.kind === "vamp" && section.value.passes === UNTIL_RELEASED);
const summary = computed(() => section.value ? formatSectionChip(section.value) : "As recorded");

watch(() => [props.run.first, props.run.last, section.value], () => {
  passes.value = section.value && section.value.kind !== "cut" ? section.value.passes : null;
  pending.value = undefined;
  error.value = undefined;
}, { immediate: true });

function describeOverlaps(matches: readonly SectionMatch[]): string {
  return matches.map(match => formatSectionName(measures.value, match.section)).join(" and ");
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The resulting section list is checked as a whole, so an invalid change is explained instead of saved. */
async function save(sections: readonly Section[], action: () => Promise<void>): Promise<void> {
  const [issue] = validateSections(measures.value, timeline.value, sections);
  error.value = issue?.reason;
  if (issue) {
    return;
  }

  try {
    await action();
    player.syncWarp();
  } catch (failure) {
    notifyError("Could not save the section", failure);
  }
}

async function replaceTarget(next: Section | undefined): Promise<void> {
  const index = target.value?.index;
  if (index === undefined) {
    return;
  }

  const others = props.song.getSections().filter((_, i) => i !== index);
  if (next) {
    await save([...others, next], () => props.song.updateSection(index, next));
  } else {
    await save(others, () => props.song.removeSection(index));
  }
}

/** A section always covers whole measures, so a stored one that starts or ends mid-measure snaps when edited. */
function snapped(next: Section): Section {
  const run = section.value && getSectionRun(timeline.value, section.value);
  return withRun(measures.value, timeline.value, next, run ?? props.run);
}

function confirmRemoval(): void {
  const name = targetName.value;
  if (!name) {
    return;
  }

  confirm.require({
    header: "Remove section",
    message: `Remove ${lowerFirst(name)}? These measures will play as recorded.`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Remove", severity: "danger" },
    accept: () => replaceTarget(undefined),
  });
}

async function selectKind(choice: Choice): Promise<void> {
  pending.value = undefined;
  if (choice === "recorded") {
    confirmRemoval();
    return;
  }

  if (target.value) {
    const { from, to } = toMeasureRange(measures.value, timeline.value, getSectionRun(timeline.value, target.value.section) ?? props.run);
    await replaceTarget(createSection(choice, from, to));
    return;
  }

  const { from, to } = toMeasureRange(measures.value, timeline.value, props.run);
  const created = createSection(choice, from, to);
  if (overlapping.value.length > 0) {
    pending.value = created;
    return;
  }

  await save([...props.song.getSections(), created], () => props.song.addSection(created));
}

async function replaceOverlapping(): Promise<void> {
  const created = pending.value;
  if (!created) {
    return;
  }

  // The first overlapped section is replaced in place, so removing the later ones never shifts its index.
  const [kept, ...removed] = overlapping.value.map(match => match.index).sort((a, b) => a - b);
  const replaced = new Set([kept, ...removed]);
  await save([...props.song.getSections().filter((_, i) => !replaced.has(i)), created], async () => {
    for (const index of removed.reverse()) {
      await props.song.removeSection(index);
    }

    await props.song.updateSection(kept!, created);
  });
  pending.value = undefined;
}

async function update(change: Partial<Section>): Promise<void> {
  if (section.value) {
    await replaceTarget(snapped({ ...section.value, ...change } as Section));
  }
}

const savePasses = useDebounceFn((value: number) => update({ passes: value }), PASSES_SAVE_DELAY_MS);

function onPassesChange(value: number | null): void {
  passes.value = value;
  if (value !== null && section.value?.kind !== "cut" && value !== section.value?.passes) {
    savePasses(value);
  }
}

// A limited vamp starts at the passes the recording has, so it plays as recorded until changed.
function changeUntilReleased(untilReleased: boolean): void {
  const recorded = section.value ? findRecordedPasses(timeline.value, section.value).length : 1;
  update({ passes: untilReleased ? UNTIL_RELEASED : Math.max(recorded, 1) });
}
</script>

<template>
  <InspectorGroup
    id="rehearsal"
    title="Rehearsal"
    :summary="summary"
  >
    <div
      v-if="target?.relation === 'contains'"
      class="flex items-center justify-between gap-2 rounded-md border-l-4 bg-surface-100 py-2 pr-1 pl-3 text-sm dark:bg-surface-800"
      :class="section && SECTION_COLORS[section.kind].border"
    >
      <span>Part of <strong>{{ targetName }}</strong></span>
      <Button
        label="Select"
        severity="secondary"
        size="small"
        text
        :aria-label="`Select ${lowerFirst(targetName ?? '')}`"
        @click="editor.selectSection(target.index)"
      />
    </div>
    <span
      v-else-if="!target"
      class="text-xs text-muted-color"
    >How rehearsals play these measures</span>

    <SelectButton
      :model-value="kind"
      class="w-full"
      :options="KIND_OPTIONS"
      option-label="label"
      option-value="value"
      :allow-empty="false"
      aria-label="Rehearsal"
      size="small"
      :pt="{ pcToggleButton: { root: 'flex-1 px-1' } }"
      @update:model-value="selectKind"
    />

    <div
      v-if="overlapping.length > 0"
      class="flex flex-col items-start gap-2"
    >
      <Message
        severity="warn"
        size="small"
        variant="simple"
      >
        These measures overlap {{ describeOverlaps(overlapping) }}.
      </Message>
      <div
        v-if="pending"
        class="flex flex-wrap gap-2"
      >
        <Button
          :label="`Replace with ${pending.kind}`"
          severity="secondary"
          size="small"
          @click="replaceOverlapping"
        />
        <Button
          label="Cancel"
          severity="secondary"
          size="small"
          text
          @click="pending = undefined"
        />
      </div>
    </div>

    <template v-if="section && section.kind !== 'cut'">
      <div class="flex items-center justify-between gap-2">
        <label
          :for="isUntilReleased ? ids.untilReleased : ids.passes"
          class="text-sm"
        >Passes</label>
        <div class="flex items-center gap-3">
          <InputNumber
            v-if="!isUntilReleased"
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
          <div
            v-if="section.kind === 'vamp'"
            class="flex items-center gap-2"
          >
            <Checkbox
              :model-value="isUntilReleased"
              :input-id="ids.untilReleased"
              binary
              @update:model-value="changeUntilReleased"
            />
            <label
              :for="ids.untilReleased"
              class="text-sm whitespace-nowrap"
            >Until released</label>
          </div>
        </div>
      </div>

      <template v-if="section.kind === 'vamp'">
        <div class="flex items-center justify-between gap-2">
          <span
            :id="ids.out"
            class="text-sm"
          >Go on</span>
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

    <span
      v-if="section"
      class="text-xs text-muted-color"
    >Drag the handles at the ends of the section on the score to change its range.</span>
  </InspectorGroup>
</template>
