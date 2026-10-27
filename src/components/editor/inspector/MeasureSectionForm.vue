<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import { useConfirm } from "primevue/useconfirm";
import { computed, ref, watch } from "vue";

import { SECTION_COLORS } from "@/components/score/sectionColors";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import type { RecordedPass } from "@/core/models/recording";
import { formatSectionName } from "@/core/models/scoreOverlays";
import { createSection, findSectionsAt, holdsRun, replaceSections, type Section, type SectionKind, toMeasureRange, validateSections } from "@/core/models/sections";
import type Song from "@/core/models/song";

import InspectorSection from "./InspectorSection.vue";

const KINDS: { value: SectionKind; label: string }[] = [
  { value: "repeat", label: "Repeat" },
  { value: "vamp", label: "Vamp" },
  { value: "cut", label: "Cut" },
];

const props = defineProps<{
  song: Song;
  run: RecordedPass;
}>();

const selection = injectEditorSelection();
const confirm = useConfirm();
const { notifyError } = useNotify();
const error = ref<string>();

const measures = computed(() => props.song.getMeasures());
const timeline = computed(() => props.song.getTimeline());
const matches = computed(() => findSectionsAt(timeline.value, props.song.getSections(), props.run));
/** The section these measures are part of, which the link selects. */
const holder = computed(() => {
  const [only, ...others] = matches.value;
  return only && others.length === 0 && holdsRun(timeline.value, only, props.run) ? only : undefined;
});
const holderName = computed(() => holder.value && formatSectionName(measures.value, holder.value));

watch(() => [props.run.first, props.run.last], () => {
  error.value = undefined;
});

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

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
    selection.select({ kind: "section", from: created.from });
  } catch (failure) {
    notifyError("Could not save the section", failure);
  }
}

function create(kind: SectionKind): void {
  const { from, to } = toMeasureRange(measures.value, timeline.value, props.run);
  const created = createSection(kind, from, to);
  const replaced = matches.value;
  if (replaced.length === 0) {
    save([], created);
    return;
  }

  const names = replaced.map(section => lowerFirst(formatSectionName(measures.value, section))).join(" and ");
  confirm.require({
    header: "Replace sections",
    message: `These measures overlap ${names}. Replace ${replaced.length === 1 ? "it" : "them"} with a ${kind}?`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Replace", severity: "danger" },
    accept: () => save(replaced, created),
  });
}
</script>

<template>
  <InspectorSection title="Section">
    <div
      v-if="holder"
      class="flex items-center justify-between gap-2 rounded-md border-l-4 bg-surface-100 py-2 pr-1 pl-3 text-sm dark:bg-surface-800"
      :class="SECTION_COLORS[holder.kind].border"
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

    <template v-else>
      <span class="text-xs text-muted-color">How rehearsals play these measures</span>
      <div class="flex flex-wrap gap-2">
        <Button
          v-for="kind in KINDS"
          :key="kind.value"
          :label="kind.label"
          severity="secondary"
          size="small"
          @click="create(kind.value)"
        />
      </div>
    </template>

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
