<script setup lang="ts">
import gsap from "gsap";
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import Slider from "primevue/slider";
import { computed, ref, watch } from "vue";

import type Song from "@/core/models/song";
import Track from "@/core/models/track";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

const player = usePlayerStore();
const settingsStore = useSettingsStore();

const props = defineProps<{
  song: Song | undefined;
}>();

const tracks = computed(() => props.song?.tracks ?? []);

// Pseudo-track for controlling all non-vocal tracks at once (if enabled in settings)
const nonVocalTrackIndices = computed<number[]>(() => tracks.value.filter(t => t.classification !== "Vocal").map(t => t.mixer.index));
const nonVocalReferenceTrack = computed<Track | undefined>(() => tracks.value[nonVocalTrackIndices.value[0]]);
const nonVocalPseudoTrack = computed<Track | undefined>(() => nonVocalReferenceTrack.value
  ? new Track("Accompaniment", "Accompaniment", 0, { ...nonVocalReferenceTrack.value.mixer, index: -1 })
  : undefined);

const trackGroups = computed<Record<string, Track[]>>(() => {
  // Group all tracks by classification (Anything non-vocal is considered accompaniment)
  const accompanimentTracks = settingsStore.current.playback.mergeAccompaniment
    ? nonVocalPseudoTrack.value ? [nonVocalPseudoTrack.value] : []
    : tracks.value.filter(t => t.classification !== "Vocal");

  const vocalTracks = tracks.value.filter(t => t.classification === "Vocal");

  const groups: Record<string, Track[]> = {
    Accompaniment: accompanimentTracks,
    Vocal: vocalTracks,
  };

  // Remove groups that have no tracks
  for (const classification in groups) {
    if (groups[classification].length === 0) {
      delete groups[classification];
    }
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

function applyWithPseudoTrack(track: Track, action: (track: Track, ...args: any[]) => void, ...args: any[]): void {
  if (track.mixer.index === -1) {
    // Apply to all non-vocal tracks
    for (const index of nonVocalTrackIndices.value) {
      const realTrack = tracks.value.find(t => t.mixer.index === index);
      if (realTrack) {
        action(realTrack, ...args);
      }
    }
  } else {
    // Apply to the single track directly
    action(track, ...args);
  }
}

const trackTweens = ref<GSAPTween[]>([]);
watch(tracks, () => {
  // configure animations
  if (tracks.value.length !== trackTweens.value.length) {
    trackTweens.value = [];
    const cs = getComputedStyle(document.documentElement);
    const colorFrom = cs.getPropertyValue("--p-primary-color").trim();
    const colorTo = cs.getPropertyValue("--p-slider-track-background").trim();
    for (const mixerIndex of Object.values(tracks.value).flatMap(t => t.mixer.index)) {
      const tween = gsap.fromTo(
        `#mixer-track-slider-${mixerIndex}`,
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
        v-for="trackGroup, classification in trackGroups"
        :key="classification"
        class="flex flex-col items-stretch justify-stretch gap-2"
      >
        <h3 class="font-bold">
          {{ classification }}
        </h3>
        <div class="flex flex-col items-stretch justify-stretch gap-4">
          <div
            v-for="track in trackGroup"
            :key="track.title"
            class="flex flex-col items-stretch justify-stretch gap-2"
          >
            <h4 v-if="trackGroup.length > 1 || classification === 'Vocal'">
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
                  @click="applyWithPseudoTrack(track, setTrackMute)"
                />
                <Button
                  label="S"
                  aria-label="Solo"
                  class="w-8"
                  :severity="track.mixer.solo ? 'warn' : 'secondary'"
                  size="small"
                  @click="applyWithPseudoTrack(track, setTrackSolo)"
                />
                <Button
                  icon="pi pi-eye"
                  aria-label="Highlight"
                  class="w-8"
                  :severity="track.mixer.highlight ? 'info' : 'secondary'"
                  size="small"
                  @click="applyWithPseudoTrack(track, setTrackHighlight)"
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
                @update:model-value="applyWithPseudoTrack(track, setTrackGain, $event as number)"
              />
            </div>
          </div>
        </div>
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
