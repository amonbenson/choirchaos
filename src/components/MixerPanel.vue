<script setup lang="ts">
import type Song from "@/core/show/song";
import Panel from "primevue/panel";
import ButtonGroup from "primevue/buttongroup";
import Button from "primevue/button";
import Slider from "primevue/slider";
import { computed, ref, watch, type Ref } from "vue";
import type { TrackClassification } from "@/core/show/track";
import type Track from "@/core/show/track";
import { usePlayerStore } from "@/stores/player";
import gsap from "gsap";

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

const trackTweens: Ref<GSAPTween[]> = ref([]);
watch(tracks, () => {
  // configure animations
  if (tracks.value.length !== trackTweens.value.length) {
    trackTweens.value = [];
    for (let i = 0; i < tracks.value.length; i++) {
      const tween = gsap.to(`#mixer-track-slider-${i}`, {
        background: "var(--color-surface-700)",
        duration: 1.0,
      });
      tween.seek(tween.endTime()); // start at the end
      trackTweens.value.push(tween);
    }
  }
}, { immediate: true, flush: "post" });


function triggerEventAnimation(trackIndex: number) {
  trackTweens.value[trackIndex].restart();
}

player.onNote(event => {
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
      class="flex flex-col justify-stretch items-stretch gap-12"
    >
      <div
        v-for="trackGroup, classification in trackByClassification"
        :key="classification"
        class="flex flex-col justify-stretch items-stretch gap-2"
      >
        <template v-if="trackGroup.length > 0">
          <h3 class="font-bold">
            {{ classification }}
          </h3>
          <div class="flex flex-col justify-stretch items-stretch gap-4">
            <div
              v-for="track in trackGroup"
              :key="track.title"
              class="flex flex-col justify-stretch items-stretch gap-2"
            >
              <h4 v-if="track.title !== classification">
                {{ track.title.replace(/^-*/, '') }}
              </h4>
              <div
                class="flex justify-stretch items-center gap-4"
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
                  v-model="track.mixer.gain"
                  class="flex-1 mx-2"
                  :min="0"
                  :max="1"
                  :step="0.001"
                  pt:range:class="bg-primary"
                  :pt:range:id="`mixer-track-slider-${track.mixer.index}`"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div
      v-else
      class="italic text-center"
    >
      No tracks available.
    </div>
  </Panel>
</template>
