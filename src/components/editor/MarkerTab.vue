<script setup lang="ts">
import Button from "primevue/button";
import { computed, ref } from "vue";

import { useNotify } from "@/composables/useNotify";
import type { MarkerEvent } from "@/core/models/measureEvent";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import MarkerRow from "./MarkerRow.vue";

const props = defineProps<{
  song: Song | undefined;
}>();

const player = usePlayerStore();
const settings = useSettingsStore();
const { notifyError } = useNotify();

const REHEARSAL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const markers = computed(() => props.song?.events.markers.items() ?? []);
const hasMeasures = computed(() => (props.song?.measures.items().length ?? 0) > 0);
const addedMarker = ref<MarkerEvent>();

// Rows keep their identity while a marker is renamed or moved, so the focus stays in the edited field.
const markerKeys = new WeakMap<MarkerEvent, number>();
let nextMarkerKey = 0;

function getMarkerKey(marker: MarkerEvent): number {
  if (!markerKeys.has(marker)) {
    markerKeys.set(marker, nextMarkerKey++);
  }

  return markerKeys.get(marker)!;
}

function isMarkerActive(marker: MarkerEvent): boolean {
  return player.currentMeasure[0] === marker.start[0];
}

// Rehearsal marks are usually letters in score order, so the next unused letter is the likeliest name.
function getNextMarkerName(): string {
  const used = new Set(markers.value.map(marker => marker.marker));
  return [...REHEARSAL_LETTERS].find(letter => !used.has(letter)) ?? `Marker ${markers.value.length + 1}`;
}

function getInsertMeasure(song: Song): string {
  return song.findMeasure(player.currentMeasure[0])?.value ?? song.measures.items()[0]!.value;
}

async function addMarker(): Promise<void> {
  const song = props.song;
  if (!song || !hasMeasures.value) {
    return;
  }

  try {
    addedMarker.value = await song.addMarker([getInsertMeasure(song), 0], getNextMarkerName());
  } catch (error) {
    notifyError("Could not add the marker", error);
  }
}

async function updateMarker(marker: MarkerEvent, measure: string, name: string): Promise<void> {
  try {
    await props.song?.updateMarker(marker, [measure, measure === marker.start[0] ? marker.start[1] : 0], name);
  } catch (error) {
    notifyError("Could not save the marker", error);
  }
}

async function removeMarker(marker: MarkerEvent): Promise<void> {
  try {
    await props.song?.removeMarker(marker);
  } catch (error) {
    notifyError("Could not delete the marker", error);
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-col gap-4">
    <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      <template v-if="song && markers.length > 0">
        <MarkerRow
          v-for="marker in markers"
          :key="getMarkerKey(marker)"
          :song="song"
          :marker="marker"
          :active="isMarkerActive(marker)"
          :autofocus="marker === addedMarker"
          @update="(measure, name) => updateMarker(marker, measure, name)"
          @remove="removeMarker(marker)"
        />
      </template>
      <span
        v-else-if="hasMeasures"
        class="text-sm text-muted-color"
      >Markers label sections like A or Chorus, so rehearsers can jump to them.</span>
      <div
        v-else
        class="flex flex-col items-start gap-2"
      >
        <span class="text-sm text-muted-color">Markers point to measures, and this song has none yet.</span>
        <Button
          label="Add measures"
          severity="secondary"
          size="small"
          @click="settings.update({ workspace: { editorTab: 'measures' } })"
        />
      </div>
    </div>

    <div
      v-if="hasMeasures"
      class="flex flex-none gap-2"
    >
      <Button
        label="Add marker"
        icon="pi pi-plus"
        severity="secondary"
        size="small"
        @click="addMarker"
      />
    </div>
  </div>
</template>
