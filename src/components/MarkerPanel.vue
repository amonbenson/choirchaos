<script setup lang="ts">
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import Panel from "primevue/panel";
import Button from "primevue/button";
import type Song from "@/core/show/song";
import type { MarkerEvent } from "@/core/show/measureEvent";

const player = usePlayerStore();

const props = defineProps<{
  song: Song | undefined;
}>();

const markers = computed(() => props.song?.events.markers.items() ?? []);

function isMarkerActive(marker: MarkerEvent) {
  return player.currentMeasure[0] === marker.start[0]; // && player.currentMeasure[1] === marker.start[1];
}
</script>

<template>
  <Panel
    header="Markers"
    pt:root="flex flex-col"
    pt:header="flex-none"
    pt:content-container="flex-1 overflow-y-scroll mb-2"
  >
    <div
      v-if="markers.length > 0"
      class="flex flex-col justify-stretch items-stretch gap-4"
    >
      <div
        v-for="marker, m in markers"
        :key="m"
        class="relative"
      >
        <Button
          class="relative flex justify-between items-center"
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
          class="absolute left-1 bottom-0 translate-y-1/2 h-0.5 bg-primary rounded-full transition-opacity"
          :class="isMarkerActive(marker) ? 'opacity-0': 'opacity-50'"
          :style="{
            width: `calc(${marker.$startTick! / player.duration * 100}% - 0.5rem)`
          }"
        />
      </div>
    </div>

    <div
      v-else
      class="italic text-center"
    >
      No markers available.
    </div>
  </Panel>
</template>
