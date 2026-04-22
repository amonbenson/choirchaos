<script setup lang="ts">
import Button from "primevue/button";
import Divider from "primevue/divider";
import Panel from "primevue/panel";
import { computed } from "vue";

import Measure from "@/core/models/measure";
import type { MarkerEvent } from "@/core/models/measureEvent";
import type Song from "@/core/models/song";
import { isNumbering } from "@/core/utils/numbering";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

const props = defineProps<{
  song: Song | undefined;
  editMode: boolean;
}>();

const markers = computed(() => props.song?.events.markers.items() ?? []);
const measures = computed(() => props.song?.measures.items() ?? []);

function isMarkerActive(marker: MarkerEvent): boolean {
  return player.currentMeasure[0] === marker.start[0];
}

async function reloadPlayer(): Promise<void> {
  if (!props.song) {
    return;
  }

  const savedPosition = player.position;
  await player.load(props.song);
  player.seek(savedPosition);
}

function incrementBeats(measure: Measure): void {
  measure.beats++;
  reloadPlayer();
}

function decrementBeats(measure: Measure): void {
  measure.beats = Math.max(1, measure.beats - 1);
  reloadPlayer();
}

function deleteMeasure(index: number): void {
  props.song?.measures.removeAt(index);
  reloadPlayer();
}

function addMeasures(): void {
  const input = prompt("Measure number or range (e.g. 1, 1a, 2-3, 4..9):");
  if (!input) {
    return;
  }

  const rangeMatch = input.match(/^(\d+)\.\.(\d+)$/);
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1]!);
    const to = parseInt(rangeMatch[2]!);
    for (let n = Math.min(from, to); n <= Math.max(from, to); n++) {
      props.song?.measures.insert(new Measure(String(n), 4));
    }
  } else {
    if (!isNumbering(input)) {
      return;
    }

    props.song?.measures.insert(new Measure(input, 4));
  }

  reloadPlayer();
}
</script>

<template>
  <Panel
    header="Markers"
    pt:root="flex flex-col"
    pt:header="flex-none"
    pt:content-container="flex-1 overflow-y-scroll mb-2"
  >
    <!-- Markers list -->
    <div
      v-if="markers.length > 0"
      class="flex flex-col items-stretch justify-stretch gap-4"
    >
      <div
        v-for="marker, m in markers"
        :key="m"
        class="relative"
      >
        <Button
          class="relative flex items-center justify-between"
          :severity="isMarkerActive(marker) ? 'primary' : 'secondary'"
          fluid
          @click="player.setMeasure(marker.start[0]); player.setBeat(marker.start[1])"
        >
          <div class="font-bold">
            T{{ marker.start[0] }}
          </div>
          <div>
            {{ marker.marker }}
          </div>
        </Button>
        <div
          class="absolute bottom-0 left-1 h-0.5 translate-y-1/2 rounded-full bg-primary transition-opacity"
          :class="isMarkerActive(marker) ? 'opacity-0': 'opacity-50'"
          :style="{
            width: `calc(${marker.$startTick! / player.duration * 100}% - 0.5rem)`
          }"
        />
      </div>
    </div>

    <div
      v-else
      class="text-center italic"
    >
      No markers available.
    </div>

    <!-- Measures section (edit mode only) -->
    <template v-if="editMode">
      <Divider class="my-2" />

      <div class="mb-1">
        <span class="text-sm font-semibold">Measures</span>
      </div>

      <div
        v-if="measures.length > 0"
        class="flex flex-col gap-0.5"
      >
        <div
          v-for="measure, i in measures"
          :key="measure.value"
          class="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-100 dark:hover:bg-surface-800"
        >
          <span class="flex-1 font-mono text-sm">{{ measure.value }}</span>
          <span class="w-5 text-center text-xs text-muted-color">{{ measure.beats }}</span>
          <Button
            icon="pi pi-minus"
            size="small"
            text
            rounded
            :disabled="measure.beats <= 1"
            aria-label="Decrement beats"
            @click="decrementBeats(measure)"
          />
          <Button
            icon="pi pi-plus"
            size="small"
            text
            rounded
            aria-label="Increment beats"
            @click="incrementBeats(measure)"
          />
          <Button
            icon="pi pi-trash"
            size="small"
            text
            rounded
            severity="danger"
            aria-label="Delete measure"
            @click="deleteMeasure(i)"
          />
        </div>
      </div>

      <div
        v-else
        class="text-center text-sm italic"
      >
        No measures defined.
      </div>

      <Button
        icon="pi pi-plus"
        label="Add measures"
        size="small"
        severity="secondary"
        class="mt-2"
        fluid
        @click="addMeasures"
      />
    </template>
  </Panel>
</template>
