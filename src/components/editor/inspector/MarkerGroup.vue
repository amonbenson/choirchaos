<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { computed, nextTick, ref, toRaw } from "vue";

import { useNotify } from "@/composables/useNotify";
import { formatLocation, formatOrdinal, formatTimes } from "@/core/models/locationFormat";
import { addMarker, type Marker, removeMarker, replaceMarker } from "@/core/models/markers";
import type { SelectedRun } from "@/core/models/measureSelection";
import { countOccurrences, type Location } from "@/core/models/recording";
import type Song from "@/core/models/song";

import InspectorGroup from "./InspectorGroup.vue";

const REHEARSAL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const props = defineProps<{
  song: Song;
  run: SelectedRun;
}>();

const { notifyError } = useNotify();
const list = ref<HTMLElement>();

/** A marker goes on beat 1 of the selected occurrence, or of the first measure of a selected range. */
const at = computed<Location>(() => {
  const entry = props.song.getTimeline()[props.run.first]!;
  return { measure: entry.measure, occurrence: entry.occurrence, beat: 0 };
});

const markers = computed(() => props.song.getMarkers()
  .filter(marker => marker.at.measure === at.value.measure && marker.at.occurrence === at.value.occurrence));
const playsMoreThanOnce = computed(() => countOccurrences(props.song.getTimeline(), at.value.measure) > 1);
const place = computed(() => formatLocation(props.song, at.value));
const summary = computed(() => markers.value.map(marker => marker.text).join(", "));

// Fields keep their identity while a marker is renamed, so the focus stays in the edited field.
const markerKeys = new WeakMap<Marker, number>();
let nextMarkerKey = 0;

function getMarkerKey(marker: Marker): number {
  const raw = toRaw(marker);
  if (!markerKeys.has(raw)) {
    markerKeys.set(raw, nextMarkerKey++);
  }

  return markerKeys.get(raw)!;
}

function describePlace(marker: Marker): string | undefined {
  const parts = [
    playsMoreThanOnce.value ? `On the ${formatTimes(marker.at.occurrence)}` : undefined,
    marker.at.beat > 0 ? `on the ${formatOrdinal(marker.at.beat + 1)} beat` : undefined,
  ].filter(Boolean);
  const text = parts.join(", ");
  return text && text.charAt(0).toUpperCase() + text.slice(1);
}

// Rehearsal marks are usually letters in score order, so the next unused letter is the likeliest name.
function getNextMarkerName(): string {
  const used = new Set(props.song.getMarkers().map(marker => marker.text));
  return [...REHEARSAL_LETTERS].find(letter => !used.has(letter)) ?? `Marker ${props.song.getMarkers().length + 1}`;
}

async function focusMarker(marker: Marker): Promise<void> {
  await nextTick();
  const input = list.value?.querySelector<HTMLInputElement>(`[data-marker-key="${getMarkerKey(marker)}"]`);
  input?.focus();
  input?.select();
}

async function addMarkerHere(): Promise<void> {
  const marker = { at: { ...at.value }, text: getNextMarkerName() };
  try {
    await props.song.editLayers({ markers: addMarker(props.song.getMarkers(), marker) });
    await focusMarker(marker);
  } catch (error) {
    notifyError("Could not add the marker", error);
  }
}

async function rename(marker: Marker, input: HTMLInputElement): Promise<void> {
  const text = input.value.trim();
  if (!text || text === marker.text) {
    input.value = marker.text;
    return;
  }

  const renamed = { at: { ...marker.at }, text };
  markerKeys.set(renamed, getMarkerKey(marker));
  try {
    await props.song.editLayers({ markers: replaceMarker(props.song.getMarkers(), marker, renamed) });
  } catch (error) {
    notifyError("Could not save the marker", error);
  }
}

async function deleteMarker(marker: Marker): Promise<void> {
  try {
    await props.song.editLayers({ markers: removeMarker(props.song.getMarkers(), marker) });
  } catch (error) {
    notifyError("Could not delete the marker", error);
  }
}
</script>

<template>
  <InspectorGroup
    id="marker"
    title="Marker"
    :summary="summary"
  >
    <ul
      v-if="markers.length > 0"
      ref="list"
      class="flex flex-col gap-2"
      aria-label="Markers"
    >
      <li
        v-for="marker in markers"
        :key="getMarkerKey(marker)"
        class="flex flex-col gap-1"
      >
        <div class="flex items-center gap-2">
          <i
            class="pi pi-bookmark text-primary"
            aria-hidden="true"
          />
          <InputText
            :model-value="marker.text"
            class="min-w-0 flex-1"
            size="small"
            :data-marker-key="getMarkerKey(marker)"
            :aria-label="`Name of marker ${marker.text}`"
            @blur="rename(marker, $event.target as HTMLInputElement)"
            @keydown.enter="rename(marker, $event.target as HTMLInputElement)"
            @keydown.esc="($event.target as HTMLInputElement).value = marker.text"
          />
          <Button
            icon="pi pi-trash"
            severity="danger"
            size="small"
            :aria-label="`Delete marker ${marker.text}`"
            text
            rounded
            @click="deleteMarker(marker)"
          />
        </div>
        <span
          v-if="describePlace(marker)"
          class="text-xs text-muted-color"
        >{{ describePlace(marker) }}</span>
      </li>
    </ul>

    <Button
      v-else
      :label="`Add marker at ${place}`"
      icon="pi pi-bookmark"
      severity="secondary"
      size="small"
      class="self-start"
      @click="addMarkerHere"
    />
  </InspectorGroup>
</template>
