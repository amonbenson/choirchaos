<script setup lang="ts">
import type Song from "@/core/show/song";
import Panel from "primevue/panel";
import ScrollPanel from "primevue/scrollpanel";
import ButtonGroup from "primevue/buttongroup";
import Button from "primevue/button";
import Slider from "primevue/slider";
import { computed } from "vue";
import type { TrackClassification } from "@/core/show/track";
import type Track from "@/core/show/track";

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
            <div class="flex justify-stretch items-center gap-4">
              <ButtonGroup>
                <Button
                  label="M"
                  class="w-8"
                  :severity="track.mixer.mute ? 'primary' : 'secondary'"
                  size="small"
                  @click="track.mixer.mute = !track.mixer.mute"
                />
                <Button
                  label="S"
                  class="w-8"
                  :severity="track.mixer.solo ? 'warn' : 'secondary'"
                  size="small"
                  @click="track.mixer.solo = !track.mixer.solo"
                />
              </ButtonGroup>
              <Slider
                v-model="track.mixer.gain"
                :disabled="track.mixer.mute"
                class="flex-1 mx-2"
                :min="0"
                :max="1"
                :step="0.001"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </Panel>
</template>
