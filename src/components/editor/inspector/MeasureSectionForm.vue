<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import { computed, ref, watch } from "vue";

import { SECTION_COLORS } from "@/components/score/sectionColors";
import { useConfirmDestructive } from "@/composables/useConfirmDestructive";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import type { RecordedPass } from "@/core/models/recording";
import { formatSectionName } from "@/core/models/scoreOverlays";
import {
  createSection,
  findCaesura,
  findSectionsAt,
  getCaesuraAfter,
  holdsRun,
  type RangeSection,
  replaceSections,
  type Section,
  type SectionKind,
  toMeasureRange,
  validateSections,
} from "@/core/models/sections";
import type Song from "@/core/models/song";
import { lowerFirst } from "@/core/utils/text";

import InspectorSection from "./InspectorSection.vue";

const KINDS: { value: RangeSection["kind"]; label: string }[] = [
  { value: "repeat", label: "Repeat" },
  { value: "vamp", label: "Vamp" },
  { value: "cut", label: "Cut" },
];

/** A button adding a section is outlined and labeled in that section's color. */
function kindClass(kind: SectionKind): string[] {
  return [SECTION_COLORS[kind].border, SECTION_COLORS[kind].text];
}

const props = defineProps<{
  song: Song;
  run: RecordedPass;
}>();

const selection = injectEditorSelection();
const confirmDestructive = useConfirmDestructive();
const { notifyError } = useNotify();
const error = ref<string>();

const measures = computed(() => props.song.getMeasures());
const timeline = computed(() => props.song.getTimeline());
const matches = computed(() => findSectionsAt(timeline.value, props.song.getSections(), props.run));
/** The section these measures are part of, which the link selects. */
const holder = computed(() => {
  const [only, ...others] = matches.value;
  return only && others.length === 0 && holdsRun(timeline.value, props.song.getSections(), only, props.run) ? only : undefined;
});
const holderName = computed(() => holder.value && formatSectionName(measures.value, holder.value));

/** A caesura after these measures stops playback before the measure the recording plays next. */
const caesuraAt = computed(() => getCaesuraAfter(timeline.value, props.run));
const caesura = computed(() => caesuraAt.value && findCaesura(props.song.getSections(), caesuraAt.value));
const lastLabel = computed(() => props.song.findMeasure(timeline.value[props.run.last]!.measure)?.label ?? "?");

watch([() => props.run.first, () => props.run.last], () => {
  error.value = undefined;
});

/** The new section list is checked as a whole, so an invalid change is explained instead of saved. */
async function save(replaced: readonly Section[], created: Section): Promise<void> {
  const sections = replaceSections(props.song.getSections(), replaced, created);
  const [issue] = validateSections(measures.value, timeline.value, sections);
  error.value = issue?.reason;
  if (issue) {
    return;
  }

  try {
    await props.song.editLayers({ sections });
    selection.select(created.kind === "caesura" ? { kind: "caesura", at: created.at } : { kind: "section", from: created.from });
  } catch (failure) {
    notifyError("Could not save the section", failure);
  }
}

function addCaesura(): void {
  const at = caesuraAt.value;
  if (at) {
    save([], { kind: "caesura", at });
  }
}

async function create(kind: RangeSection["kind"]): Promise<void> {
  const { from, to } = toMeasureRange(measures.value, timeline.value, props.run);
  const created = createSection(kind, from, to);
  const replaced = matches.value;
  const names = replaced.map(section => lowerFirst(formatSectionName(measures.value, section))).join(" and ");
  const confirmed = replaced.length === 0 || await confirmDestructive({
    header: "Replace sections",
    message: `These measures overlap ${names}. Replace ${replaced.length === 1 ? "it" : "them"} with a ${kind}?`,
    accept: "Replace",
  });
  if (confirmed) {
    await save(replaced, created);
  }
}
</script>

<template>
  <InspectorSection title="Section">
    <div
      v-if="holder"
      class="flex items-center justify-between gap-2 rounded-md bg-surface-100 py-2 pr-1 pl-3 text-sm dark:bg-surface-800"
    >
      <span>Part of <strong>{{ holderName }}</strong></span>
      <Button
        label="Select"
        severity="secondary"
        size="small"
        text
        :aria-label="`Select ${lowerFirst(holderName ?? '')}`"
        @click="selection.select({ kind: 'section', from: holder.from })"
      />
    </div>

    <div class="flex flex-wrap gap-2">
      <template v-if="!holder">
        <Button
          v-for="kind in KINDS"
          :key="kind.value"
          :label="kind.label"
          :aria-label="`Add ${lowerFirst(kind.label)}`"
          icon="pi pi-plus"
          severity="secondary"
          variant="outlined"
          size="small"
          :class="kindClass(kind.value)"
          @click="create(kind.value)"
        />
      </template>
      <Button
        v-if="caesuraAt && !caesura"
        label="Caesura"
        :aria-label="`Add caesura after ${lastLabel}`"
        icon="pi pi-plus"
        severity="secondary"
        variant="outlined"
        size="small"
        :class="kindClass('caesura')"
        @click="addCaesura"
      />
      <Button
        v-else-if="caesura"
        label="Select caesura"
        severity="secondary"
        size="small"
        text
        :aria-label="`Select caesura after ${lastLabel}`"
        @click="selection.select({ kind: 'caesura', at: caesura.at })"
      />
    </div>

    <Message
      v-if="error"
      severity="error"
      size="small"
      variant="simple"
    >
      {{ error }}
    </Message>
  </InspectorSection>
</template>
