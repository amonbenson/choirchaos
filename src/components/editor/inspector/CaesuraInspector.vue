<script setup lang="ts">
import Button from "primevue/button";
import Message from "primevue/message";
import { computed, ref, watch } from "vue";

import { useConfirmDestructive } from "@/composables/useConfirmDestructive";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import { formatLocation, formatOrdinal } from "@/core/models/locationFormat";
import type { Location } from "@/core/models/recording";
import { formatSectionName } from "@/core/models/scoreOverlays";
import { type CaesuraSection, isSameStart, replaceSections, validateSections } from "@/core/models/sections";
import type Song from "@/core/models/song";
import { lowerFirst } from "@/core/utils/text";
import { usePlayerStore } from "@/stores/player";

import RemoveButton from "./RemoveButton.vue";

const props = defineProps<{
  song: Song;
  section: CaesuraSection;
}>();

const player = usePlayerStore();
const selection = injectEditorSelection();
const confirmDestructive = useConfirmDestructive();
const { notifyError } = useNotify();
const error = ref<string>();

watch(() => props.section, () => {
  error.value = undefined;
});

const place = computed(() => `${formatLocation(props.song, props.section.at)}, ${formatOrdinal(props.section.at.beat + 1)} beat`);

const playhead = computed<Location | undefined>(() => {
  const location = player.ready ? player.currentLocation : undefined;
  return location && { measure: location.measure, occurrence: location.occurrence, beat: location.beat };
});

const isAtPlayhead = computed(() => !!playhead.value && isSameStart(playhead.value, props.section.at));

/** The new section list is checked as a whole, so an invalid change is explained instead of saved. */
async function replace(next: CaesuraSection | undefined): Promise<void> {
  const sections = replaceSections(props.song.getSections(), [props.section], next);
  const [issue] = validateSections(props.song.getMeasures(), props.song.getTimeline(), sections);
  error.value = issue?.reason;
  if (issue) {
    return;
  }

  try {
    await props.song.editLayers({ sections });
    selection.select(next ? { kind: "caesura", at: next.at } : { kind: "none" });
  } catch (failure) {
    notifyError("Could not save the caesura", failure);
  }
}

function moveToPlayhead(): void {
  const at = playhead.value;
  if (at) {
    replace({ kind: "caesura", at });
  }
}

async function remove(): Promise<void> {
  const name = lowerFirst(formatSectionName(props.song.getMeasures(), props.section));
  const confirmed = await confirmDestructive({
    header: "Remove caesura",
    message: `Remove ${name}? Playback will no longer stop there.`,
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
    <div class="flex flex-col gap-2">
      <dl class="m-0 flex items-center justify-between gap-4 text-sm">
        <dt>Before</dt>
        <dd class="m-0">
          {{ place }}
        </dd>
      </dl>
      <Button
        label="Move to playhead"
        severity="secondary"
        size="small"
        class="self-start"
        :disabled="!playhead || isAtPlayhead"
        @click="moveToPlayhead"
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

    <span class="text-xs text-muted-color">Playback stops before this beat and continues once played again. Going round a repeat or vamp again passes it, leaving one stops here.</span>

    <RemoveButton
      label="Remove caesura"
      @click="remove"
    />
  </div>
</template>
