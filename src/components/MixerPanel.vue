<script setup lang="ts">
import gsap from "gsap";
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import Slider from "primevue/slider";
import { computed, type Ref, ref, watch } from "vue";

import type Song from "@/core/show/song";
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
    Accompaniment: [],
    Percussion: [],
    Vocal: [],
  };

  for (const track of tracks.value) {
    groups[track.classification].push(track);
  }

  return groups;
});

const trackTweens: Ref<GSAPTween[]> = ref([]);
watch(tracks, () => {
  // configure animations
  if (tracks.value.length !== trackTweens.value.length) {
    trackTweens.value = [];
    for (let i = 0; i < tracks.value.length; i++) {
      const tween = gsap.to(`#mixer-track-slider-${i}`, {
        background: "var(--p-slider-track-background)",
        duration: 1.0,
      });
      tween.seek(tween.endTime()); // start at the end
      trackTweens.value.push(tween);
    }
  }
}, { immediate: true, flush: "post" });

function triggerEventAnimation(trackIndex: number): void {
  trackTweens.value[trackIndex]?.restart();
}

player.onNote((event) => {
  // trigger the flash event
  triggerEventAnimation(event.trackIndex);
});
</script>

<template>
  <Panel
    header="Mixer"
    pt:root="flex flex-col"
    pt:header="flex-none"
    pt:content-container="flex-1 overflow-y-scroll mb-2"
  >
    <div
      v-if="tracks.length > 0"
      class="flex flex-col items-stretch justify-stretch gap-12"
    >
      <div
        v-for="trackGroup, classification in trackByClassification"
        :key="classification"
        class="flex flex-col items-stretch justify-stretch gap-2"
      >
        <template v-if="trackGroup.length > 0">
          <h3 class="font-bold">
            {{ classification }}
          </h3>
          <div class="flex flex-col items-stretch justify-stretch gap-4">
            <div
              v-for="track in trackGroup"
              :key="track.title"
              class="flex flex-col items-stretch justify-stretch gap-2"
            >
              <h4 v-if="track.title !== classification">
                {{ track.title.replace(/^-*/, '') }}
              </h4>
              <div
                class="flex items-center justify-stretch gap-4"
                :class="{ 'opacity-50': track.mixer.effectiveMute }"
              >
                <ButtonGroup>
                  <Button
                    label="M"
                    aria-label="Mute"
                    class="w-8"
                    :severity="track.mixer.mute ? 'primary' : 'secondary'"
                    size="small"
                    @click="song?.setTrackMute(track.mixer.index, !track.mixer.mute)"
                  />
                  <Button
                    label="S"
                    aria-label="Solo"
                    class="w-8"
                    :severity="track.mixer.solo ? 'warn' : 'secondary'"
                    size="small"
                    @click="song?.setTrackSolo(track.mixer.index, !track.mixer.solo)"
                  />
                  <Button
                    icon="pi pi-eye"
                    aria-label="Highlight"
                    class="w-8"
                    :severity="track.mixer.highlight ? 'info' : 'secondary'"
                    size="small"
                    @click="song?.setTrackHighlight(track.mixer.index, !track.mixer.highlight)"
                  />
                </ButtonGroup>
                <Slider
                  :model-value="track.mixer.gain"
                  class="mx-2 flex-1"
                  :min="0"
                  :max="1"
                  :step="0.001"
                  pt:range:class="bg-primary"
                  :pt:range:id="`mixer-track-slider-${track.mixer.index}`"
                  @update:model-value="song?.setTrackGain(track.mixer.index, $event as number)"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div
      v-else
      class="text-center italic"
    >
      No tracks available.
    </div>
  </Panel>
</template>
