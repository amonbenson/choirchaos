<script setup lang="ts">
import Button from "primevue/button";
import { computed, ref, watch } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useRecordingEditor } from "@/composables/useRecordingEditor";
import { findStretchAt, getRecordingStretches, moveSpan, type RecordingStretch, removeSpan } from "@/core/models/recording";
import type Song from "@/core/models/song";

import RecordingTextForm from "./RecordingTextForm.vue";
import RemoveButton from "./RemoveButton.vue";

const props = defineProps<{
  song: Song;
  index: number;
  stretch: RecordingStretch;
}>();

const selection = injectEditorSelection();
const recording = useRecordingEditor(() => props.song);
const { saving, status } = recording;
const editingText = ref(false);

const editable = computed(() => props.song.isRecordingEditable());
const count = computed(() => props.song.getRecording().length);
const length = computed(() => props.stretch.last - props.stretch.first + 1);

watch(() => props.index, () => {
  editingText.value = false;
});

/**
 * Swaps the pass with the one before (-1) or after (1) it and keeps it selected. A pass that then
 * continues its new neighbour merges with it, so the selection follows the position it starts at.
 */
async function move(offset: -1 | 1): Promise<void> {
  const measures = props.song.getMeasures();
  const spans = props.song.getRecording();
  const neighbour = getRecordingStretches(measures, spans)[props.index + offset]!;
  const start = props.stretch.first + offset * (neighbour.last - neighbour.first + 1);
  if (await recording.setSpans(moveSpan(measures, spans, props.index, offset))) {
    selection.select({ kind: "pass", index: findStretchAt(getRecordingStretches(measures, props.song.getRecording()), start) });
  }
}

async function remove(): Promise<void> {
  if (count.value > 1 && await recording.setSpans(removeSpan(props.song.getMeasures(), props.song.getRecording(), props.index))) {
    selection.clear();
  }
}

defineExpose({ remove });
</script>

<template>
  <div class="flex flex-col gap-4">
    <span class="text-sm">Pass {{ index + 1 }} of {{ count }}, {{ length === 1 ? "1 measure" : `${length} measures` }}</span>

    <template v-if="editable">
      <div class="flex flex-wrap gap-2">
        <Button
          label="Move earlier"
          icon="pi pi-arrow-left"
          severity="secondary"
          size="small"
          :disabled="index === 0 || saving"
          @click="move(-1)"
        />
        <Button
          label="Move later"
          icon="pi pi-arrow-right"
          icon-pos="right"
          severity="secondary"
          size="small"
          :disabled="index === count - 1 || saving"
          @click="move(1)"
        />
      </div>

      <RecordingTextForm
        v-if="editingText"
        :song="song"
        @close="editingText = false"
      />
      <Button
        v-else
        label="Edit as text"
        severity="secondary"
        size="small"
        class="self-start"
        @click="editingText = true"
      />

      <RemoveButton
        label="Remove pass"
        :disabled="count === 1 || saving"
        @click="remove"
      />
    </template>
    <span
      v-else
      class="text-xs text-muted-color"
    >A MIDI song plays its beat map, so its recording cannot be changed here.</span>

    <span
      class="text-xs text-muted-color empty:hidden"
      role="status"
    >{{ status }}</span>
  </div>
</template>
