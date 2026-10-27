<script setup lang="ts">
import Button from "primevue/button";
import { computed, ref, watch } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useRecordingEditor } from "@/composables/useRecordingEditor";
import type { RecordingStretch } from "@/core/models/recording";
import type Song from "@/core/models/song";

import RecordingTextForm from "./RecordingTextForm.vue";

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

/** Moves the pass and keeps it selected at its new place. */
async function move(offset: number): Promise<void> {
  const spans = [...props.song.getRecording()];
  const [moved] = spans.splice(props.index, 1);
  spans.splice(props.index + offset, 0, moved!);
  if (await recording.setSpans(spans)) {
    selection.select({ kind: "pass", index: props.index + offset });
  }
}

async function remove(): Promise<void> {
  if (count.value > 1 && await recording.setSpans(props.song.getRecording().filter((_, i) => i !== props.index))) {
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

      <Button
        label="Remove pass"
        icon="pi pi-trash"
        severity="danger"
        size="small"
        text
        class="self-start"
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
