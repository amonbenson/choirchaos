<script setup lang="ts">
import gsap from "gsap";
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import Slider from "primevue/slider";
import { computed, type Ref, ref, watch } from "vue";

import type Song from "@/core/models/song";
import type { TrackClassification } from "@/core/models/track";
import type Track from "@/core/models/track";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

const player = usePlayerStore();
const settingsStore = useSettingsStore();

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

// Apply persisted mixer settings whenever the song changes
watch(() => props.song, (song) => {
  if (!song) {
    return;
  }

  for (const track of song.tracks) {
    const stored = settingsStore.getTrackMixer(track.title);
    song.setTrackGain(track.mixer.index, stored.gain);
    song.setTrackMute(track.mixer.index, stored.mute);
    song.setTrackSolo(track.mixer.index, stored.solo);
    song.setTrackHighlight(track.mixer.index, stored.highlight);
  }
}, { immediate: true });

function setTrackMute(track: Track): void {
  const next = !track.mixer.mute;
  props.song?.setTrackMute(track.mixer.index, next);
  settingsStore.updateTrackMixer(track.title, { mute: next });
}

function setTrackSolo(track: Track): void {
  const next = !track.mixer.solo;
  props.song?.setTrackSolo(track.mixer.index, next);
  settingsStore.updateTrackMixer(track.title, { solo: next });
}

function setTrackHighlight(track: Track): void {
  const next = !track.mixer.highlight;
  props.song?.setTrackHighlight(track.mixer.index, next);
  settingsStore.updateTrackMixer(track.title, { highlight: next });
}

function setTrackGain(track: Track, value: number): void {
  props.song?.setTrackGain(track.mixer.index, value);
  settingsStore.updateTrackMixer(track.title, { gain: value });
}

const trackTweens: Ref<GSAPTween[]> = ref([]);
watch(tracks, () => {
  // configure animations
  if (tracks.value.length !== trackTweens.value.length) {
    trackTweens.value = [];
    const cs = getComputedStyle(document.documentElement);
    const colorFrom = cs.getPropertyValue("--p-primary-color").trim();
    const colorTo = cs.getPropertyValue("--p-slider-track-background").trim();
    for (let i = 0; i < tracks.value.length; i++) {
      const tween = gsap.fromTo(
        `#mixer-track-slider-${i}`,
        { background: colorFrom },
        { background: colorTo, duration: 1.0 },
      );
      tween.seek(tween.endTime()); // start at the end (normal gray state)
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
                    @click="setTrackMute(track)"
                  />
                  <Button
                    label="S"
                    aria-label="Solo"
                    class="w-8"
                    :severity="track.mixer.solo ? 'warn' : 'secondary'"
                    size="small"
                    @click="setTrackSolo(track)"
                  />
                  <Button
                    icon="pi pi-eye"
                    aria-label="Highlight"
                    class="w-8"
                    :severity="track.mixer.highlight ? 'info' : 'secondary'"
                    size="small"
                    @click="setTrackHighlight(track)"
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
                  @update:model-value="setTrackGain(track, $event as number)"
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
