<script setup lang="ts">
import Button from "primevue/button";
import Panel from "primevue/panel";
import { computed } from "vue";

import { MARKER_COLORS } from "@/components/score/sectionColors";
import { formatLocation } from "@/core/models/locationFormat";
import type { Marker } from "@/core/models/markers";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

const props = defineProps<{
  song: Song | undefined;
}>();

const markers = computed(() => props.song?.getMarkers() ?? []);

function isMarkerActive({ at }: Marker): boolean {
  const location = player.currentLocation;
  return location?.measure === at.measure && location.occurrence === at.occurrence;
}

function getMarkerProgress({ at }: Marker): number {
  const tick = player.getLocationTick(at);
  return tick === undefined || player.duration <= 0 ? 0 : tick / player.duration;
}
</script>

<template>
  <Panel
    header="Markers"
    pt:root="flex flex-col"
    pt:header="flex-none"
    pt:content-container="flex-1 min-h-0 flex flex-col"
    pt:content-wrapper="flex-1 min-h-0 flex flex-col"
    pt:content="flex-1 min-h-0 overflow-y-scroll mb-2"
  >
    <ul
      v-if="song && markers.length > 0"
      class="flex flex-col items-stretch justify-stretch gap-4"
      aria-label="Markers"
    >
      <li
        v-for="(marker, m) in markers"
        :key="m"
        class="relative"
      >
        <Button
          class="relative flex items-center justify-between gap-2 text-left"
          :class="isMarkerActive(marker) ? [MARKER_COLORS.background, MARKER_COLORS.contrast, 'border-transparent'] : []"
          severity="secondary"
          :aria-label="`${marker.text}, marker at ${formatLocation(song, marker.at)}`"
          fluid
          @click="player.seekLocation(marker.at)"
        >
          <span class="font-bold">{{ formatLocation(song, marker.at) }}</span>
          <span class="min-w-0 truncate">{{ marker.text }}</span>
        </Button>
        <div
          class="absolute bottom-0 left-1 h-0.5 translate-y-1/2 rounded-full transition-opacity"
          :class="[MARKER_COLORS.background, isMarkerActive(marker) ? 'opacity-0' : '']"
          :style="{ width: `calc(${getMarkerProgress(marker) * 100}% - 0.5rem)` }"
          aria-hidden="true"
        />
      </li>
    </ul>

    <div
      v-else
      class="text-center italic"
    >
      No markers available.
    </div>
  </Panel>
</template>
