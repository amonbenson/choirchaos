<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { computed } from "vue";

import FieldRow from "@/components/base/FieldRow.vue";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import { formatLocation, formatOrdinal } from "@/core/models/locationFormat";
import { type Marker, removeMarker, replaceMarker } from "@/core/models/markers";
import type { Location } from "@/core/models/recording";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

import RemoveButton from "./RemoveButton.vue";

const props = defineProps<{
  song: Song;
  marker: Marker;
}>();

const player = usePlayerStore();
const selection = injectEditorSelection();
const { notifyError } = useNotify();

function describe(at: Location): string {
  return `${formatLocation(props.song, at)}, ${formatOrdinal(at.beat + 1)} beat`;
}

const playhead = computed<Location | undefined>(() => {
  const location = player.ready ? player.currentLocation : undefined;
  return location && { measure: location.measure, occurrence: location.occurrence, beat: location.beat };
});

const isAtPlayhead = computed(() => {
  const at = props.marker.at;
  const current = playhead.value;
  return !!current && current.measure === at.measure && current.occurrence === at.occurrence && current.beat === at.beat;
});

/** Saves the changed marker and keeps it selected, since the selection knows a marker by its name and location. */
async function save(next: Marker, failure: string): Promise<void> {
  try {
    await props.song.editLayers({ markers: replaceMarker(props.song.getMarkers(), props.marker, next) });
    selection.select({ kind: "marker", marker: next });
  } catch (error) {
    notifyError(failure, error);
  }
}

function rename(input: HTMLInputElement): void {
  const text = input.value.trim();
  if (!text || text === props.marker.text) {
    input.value = props.marker.text;
    return;
  }

  save({ at: { ...props.marker.at }, text }, "Could not rename the marker");
}

function moveToPlayhead(): void {
  const at = playhead.value;
  if (at) {
    save({ at, text: props.marker.text }, "Could not move the marker");
  }
}

async function remove(): Promise<void> {
  try {
    await props.song.editLayers({ markers: removeMarker(props.song.getMarkers(), props.marker) });
    selection.clear();
  } catch (error) {
    notifyError("Could not delete the marker", error);
  }
}

defineExpose({ remove });
</script>

<template>
  <div class="flex flex-col gap-4">
    <FieldRow
      v-slot="{ id }"
      label="Name"
      input-id="marker-name"
    >
      <InputText
        :id="id"
        :model-value="marker.text"
        class="w-40"
        size="small"
        @blur="rename($event.target as HTMLInputElement)"
        @keydown.enter="rename($event.target as HTMLInputElement)"
        @keydown.esc="($event.target as HTMLInputElement).value = marker.text"
      />
    </FieldRow>

    <div class="flex flex-col gap-2">
      <dl class="m-0 flex items-center justify-between gap-4 text-sm">
        <dt>Location</dt>
        <dd class="m-0">
          {{ describe(marker.at) }}
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

    <RemoveButton
      label="Delete marker"
      :aria-label="`Delete marker ${marker.text}`"
      @click="remove"
    />
  </div>
</template>
