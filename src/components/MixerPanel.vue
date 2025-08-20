<script setup lang="ts">
import type Song from "@/core/show/song";
import Panel from "primevue/panel";
import ScrollPanel from "primevue/scrollpanel";
import ButtonGroup from "primevue/buttongroup";
import Button from "primevue/button";
import Slider from "primevue/slider";
import { computed, nextTick } from "vue";
import type { TrackClassification } from "@/core/show/track";
import type Track from "@/core/show/track";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

const props = defineProps<{
  song: Song | undefined;
}>();

const tracks = computed(() => props.song?.tracks ?? []);

const trackByClassification = computed(() => {
  const groups: Record<TrackClassification, Track[]> = {
    "Accompaniment": [],
    "Percussion": [],
    "Vocal": [],
  };

  for (const track of tracks.value) {
    groups[track.classification].push(track);
  }

  return groups;
});

player.onNote(event => {
  // trigger the flash event
  nextTick(() => {
    const sliderEl = document.getElementById(`mixer-track-slider-${event.trackIndex}`)!;
    if (sliderEl.classList.contains("mixer-background-flash")) {
      sliderEl.classList.remove("mixer-background-flash");
    }
    setTimeout(() => sliderEl.classList.add("mixer-background-flash"), 1);
  });
});
</script>

<template>
  <Panel
    header="Tracks"
    pt:root="flex flex-col"
    pt:header="flex-none"
    pt:content-container="flex-1 overflow-y-scroll mb-2"
  >
    <div class="flex flex-col justify-stretch items-stretch gap-12">
      <div
        v-for="trackGroup, classification in trackByClassification"
        :key="classification"
        class="flex flex-col justify-stretch items-stretch gap-2"
      >
        <div class="font-bold">
          {{ classification }}
        </div>
        <div class="flex flex-col justify-stretch items-stretch gap-4">
          <div
            v-for="track in trackGroup"
            :key="track.title"
            class="flex flex-col justify-stretch items-stretch gap-2"
          >
            <div
              v-if="track.title !== classification"
              class=""
            >
              {{ track.title.replace(/^-*/, '') }}
            </div>
            <div
              class="flex justify-stretch items-center gap-4"
              :class="{ 'opacity-50': track.mixer.effectiveMute }"
            >
              <ButtonGroup>
                <Button
                  label="M"
                  class="w-8"
                  :severity="track.mixer.mute ? 'primary' : 'secondary'"
                  size="small"
                  @click="song?.setTrackMute(track.mixer.index, !track.mixer.mute)"
                />
                <Button
                  label="S"
                  class="w-8"
                  :severity="track.mixer.solo ? 'warn' : 'secondary'"
                  size="small"
                  @click="song?.setTrackSolo(track.mixer.index, !track.mixer.solo)"
                />
              </ButtonGroup>
              <Slider
                v-model="track.mixer.gain"
                class="flex-1 mx-2"
                :min="0"
                :max="1"
                :step="0.001"
                pt:range:class="bg-surface-700"
                :pt:range:id="`mixer-track-slider-${track.mixer.index}`"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Panel>
</template>

<style>
@keyframes mixer-background-flash {
  0% { background-color: var(--color-primary-500); }
  10% { background-color: var(--color-primary-500); }
  100% { background-color: var(--color-surface-700); }
}

.mixer-background-flash {
  background: var(--color-surface-700);
  animation: mixer-background-flash 1s linear;
}
</style>
