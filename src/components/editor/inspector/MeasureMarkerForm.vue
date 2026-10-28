<script setup lang="ts">
import Button from "primevue/button";
import { computed, nextTick } from "vue";

import { injectEditorSelection } from "@/composables/useEditorSelection";
import { useNotify } from "@/composables/useNotify";
import { formatLocation } from "@/core/models/locationFormat";
import { addMarker, type Marker } from "@/core/models/markers";
import type { Location, RecordedPass } from "@/core/models/recording";
import type Song from "@/core/models/song";

import InspectorSection from "./InspectorSection.vue";

const REHEARSAL_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const props = defineProps<{
  song: Song;
  run: RecordedPass;
}>();

const selection = injectEditorSelection();
const { notifyError } = useNotify();

/** A new marker goes on beat 1 of the first measure of the selected pass. */
const at = computed<Location>(() => {
  const entry = props.song.getTimeline()[props.run.first]!;
  return { measure: entry.measure, occurrence: entry.occurrence, beat: 0 };
});

const markers = computed(() => props.song.getMarkers()
  .filter(marker => marker.at.measure === at.value.measure && marker.at.occurrence === at.value.occurrence));
const place = computed(() => formatLocation(props.song, at.value));

// Rehearsal marks are usually letters in score order, so the next unused letter is the likeliest name.
function getNextMarkerName(): string {
  const used = new Set(props.song.getMarkers().map(marker => marker.text));
  return [...REHEARSAL_LETTERS].find(letter => !used.has(letter)) ?? `Marker ${props.song.getMarkers().length + 1}`;
}

/** Adds the marker and selects it with its name ready to be typed over. */
async function add(): Promise<void> {
  const marker: Marker = { at: { ...at.value }, text: getNextMarkerName() };
  try {
    await props.song.editLayers({ markers: addMarker(props.song.getMarkers(), marker) });
    selection.select({ kind: "marker", marker });
    await nextTick();
    const input = document.getElementById("marker-name");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  } catch (error) {
    notifyError("Could not add the marker", error);
  }
}
</script>

<template>
  <InspectorSection title="Markers">
    <ul
      v-if="markers.length > 0"
      class="flex flex-wrap gap-2"
      aria-label="Markers here"
    >
      <li
        v-for="marker in markers"
        :key="`${marker.at.beat}-${marker.text}`"
      >
        <Button
          :label="marker.text"
          icon="pi pi-bookmark"
          severity="secondary"
          size="small"
          :aria-label="`Select marker ${marker.text}`"
          @click="selection.select({ kind: 'marker', marker })"
        />
      </li>
    </ul>
    <Button
      :label="`Add marker at ${place}`"
      icon="pi pi-bookmark"
      severity="secondary"
      size="small"
      class="self-start"
      text
      @click="add"
    />
  </InspectorSection>
</template>
