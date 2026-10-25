<script setup lang="ts">
import Button from "primevue/button";
import { computed, ref } from "vue";

import { useNotify } from "@/composables/useNotify";
import type { Marker } from "@/core/models/markers";
import type { Location } from "@/core/models/recording";
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

const markers = computed(() => props.song?.getMarkers() ?? []);
const hasMeasures = computed(() => (props.song?.getTimeline().length ?? 0) > 0);
const addedMarker = ref<Marker>();

// Rows keep their identity while a marker is renamed or moved, so the focus stays in the edited field.
const markerKeys = new WeakMap<Marker, number>();
let nextMarkerKey = 0;

function getMarkerKey(marker: Marker): number {
  if (!markerKeys.has(marker)) {
    markerKeys.set(marker, nextMarkerKey++);
  }

  return markerKeys.get(marker)!;
}

function isMarkerActive({ at }: Marker): boolean {
  const location = player.currentLocation;
  return location?.measure === at.measure && location.occurrence === at.occurrence;
}

// Rehearsal marks are usually letters in score order, so the next unused letter is the likeliest name.
function getNextMarkerName(): string {
  const used = new Set(markers.value.map(marker => marker.text));
  return [...REHEARSAL_LETTERS].find(letter => !used.has(letter)) ?? `Marker ${markers.value.length + 1}`;
}

// A new marker goes where playback is, so a rehearser can stop at a section and mark it.
function getInsertLocation(song: Song): Location {
  const current = player.currentLocation;
  if (current && song.findMeasure(current.measure)) {
    return { measure: current.measure, occurrence: current.occurrence, beat: 0 };
  }

  const first = song.getTimeline()[0]!;
  return { measure: first.measure, occurrence: first.occurrence, beat: 0 };
}

async function addMarker(): Promise<void> {
  const song = props.song;
  if (!song || !hasMeasures.value) {
    return;
  }

  try {
    addedMarker.value = await song.addMarker(getInsertLocation(song), getNextMarkerName());
  } catch (error) {
    notifyError("Could not add the marker", error);
  }
}

async function updateMarker(marker: Marker, at: Location, text: string): Promise<void> {
  try {
    await props.song?.updateMarker(marker, at, text);
  } catch (error) {
    notifyError("Could not save the marker", error);
  }
}

async function removeMarker(marker: Marker): Promise<void> {
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
          @update="(at, text) => updateMarker(marker, at, text)"
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
