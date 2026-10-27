<script setup lang="ts">
import Button from "primevue/button";
import { useConfirm } from "primevue/useconfirm";
import { computed, useId } from "vue";

import MeasureNumberForm from "@/components/editor/measures/MeasureNumberForm.vue";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import { formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import type Measure from "@/core/models/measure";
import { planDeleteMeasures, planRemoveBoxes } from "@/core/models/measureEditing";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

import MeasureMarkerForm from "./MeasureMarkerForm.vue";
import MeasureRecordingForm from "./MeasureRecordingForm.vue";
import MeasureSectionForm from "./MeasureSectionForm.vue";
import MeasureSyncForm from "./MeasureSyncForm.vue";

const props = defineProps<{
  song: Song;
  /** The selected measures in reading order. */
  measures: Measure[];
}>();

const player = usePlayerStore();
const editor = injectMeasureEditor();
const { mode, saving } = editor;
const { runs, run } = injectEditorSelection();
const confirm = useConfirm();
const { notifyError } = useNotify();
const passesId = useId();

const passes = computed(() => runs.value.map(candidate => ({ run: candidate, occurrence: props.song.getTimeline()[candidate.first]!.occurrence })));
const isAudio = computed(() => props.song.playerMode === "audio");

const names = computed(() => {
  const [first] = props.measures;
  if (props.measures.length === 1) {
    return `measure ${first!.label}`;
  }

  return run.value ? `measures ${first!.label} to ${props.measures.at(-1)!.label}` : `${props.measures.length} measures`;
});

/** MIDI songs keep the measures of their beat map, so deleting only takes them off the score. */
const deleteMessage = computed(() => {
  const subject = names.value.charAt(0).toUpperCase() + names.value.slice(1);
  return mode.value === "audio"
    ? `${subject} will be deleted from the song and the score, together with their markers, sections and sync points.`
    : `${subject} will be taken off the score. The beat map keeps playing them, so they stay in the song and show under "Not on the score", where they can be placed again.`;
});

function remove(): void {
  const targets = [...props.measures];
  confirm.require({
    header: targets.length === 1 ? "Delete measure" : "Delete measures",
    message: deleteMessage.value,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Delete", severity: "danger" },
    accept: async () => {
      try {
        await editor.apply(mode.value === "audio" ? planDeleteMeasures(targets) : planRemoveBoxes(targets));
      } catch (error) {
        notifyError("Could not delete the measures", error);
      }
    },
  });
}

defineExpose({ remove });
</script>

<template>
  <div class="flex flex-col gap-4">
    <div
      v-if="passes.length > 1"
      class="flex flex-col gap-2"
    >
      <span
        :id="passesId"
        class="text-xs text-muted-color"
      >Pass, follows the playhead</span>
      <div
        role="group"
        class="flex flex-wrap gap-1"
        :aria-labelledby="passesId"
      >
        <Button
          v-for="pass in passes"
          :key="pass.run.first"
          :label="formatOrdinal(pass.occurrence)"
          :aria-label="formatTimes(pass.occurrence)"
          :aria-pressed="pass.run === run"
          :severity="pass.run === run ? 'primary' : 'secondary'"
          :text="pass.run !== run"
          size="small"
          rounded
          @click="player.seekPosition(pass.run.first)"
        />
      </div>
    </div>

    <MeasureNumberForm :measures="measures" />

    <template v-if="run">
      <MeasureSectionForm
        :song="song"
        :run="run"
      />
      <MeasureMarkerForm
        :song="song"
        :run="run"
      />
      <MeasureRecordingForm
        v-if="song.isRecordingEditable()"
        :song="song"
        :run="run"
      />
      <MeasureSyncForm
        v-if="isAudio"
        :song="song"
        :run="run"
      />
    </template>
    <span
      v-else-if="measures.length > 1"
      class="text-sm text-muted-color"
    >Select measures that play one after another to repeat, vamp or cut them.</span>

    <Button
      label="Delete"
      icon="pi pi-trash"
      severity="danger"
      size="small"
      text
      class="self-start"
      :aria-label="`Delete ${names}`"
      :disabled="saving"
      @click="remove"
    />
  </div>
</template>
