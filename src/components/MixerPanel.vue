<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import Slider from "primevue/slider";
import { computed, ref, watch } from "vue";

import type Song from "@/core/models/song";
import Track, { type TrackClassification } from "@/core/models/track";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

class MergedTrack {
  constructor(
    public tracks: Track[],
    public title: string,
    public classification: TrackClassification = "Accompaniment",
    public program: number = 0,
  ) {}

  get mixer(): Track["mixer"] {
    return this.tracks[0].mixer;
  }

  applyToEach(fn: (track: Track, ...args: any[]) => void, ...args: any[]): void {
    this.tracks.forEach(t => fn(t, ...args));
  }
}

const player = usePlayerStore();
const settingsStore = useSettingsStore();

const props = defineProps<{
  song: Song | undefined;
}>();

const tracks = computed(() => props.song?.tracks ?? []);

const tracksByClassification = computed<Record<string, (Track | MergedTrack)[]>>(() => {
  // Group all tracks by classification (Anything non-vocal is considered accompaniment)
  const nonVocalTracks = tracks.value.filter(t => t.classification !== "Vocal");
  const accompanimentTracks = settingsStore.current.appearance.mergeAccompaniment
    ? [new MergedTrack(nonVocalTracks, "Accompaniment (Merged)")]
    : nonVocalTracks;

  const vocalTracks = tracks.value.filter(t => t.classification === "Vocal");

  const groups: Record<string, (Track | MergedTrack)[]> = {
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

function setTrackMute(track: Track | MergedTrack): void {
  const next = !track.mixer.mute;
  settingsStore.updateTrackMixer(track.title, { mute: next });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackMute);
  } else {
    props.song?.setTrackMute(track.mixer.index, next);
  }
}

function setTrackSolo(track: Track | MergedTrack): void {
  const next = !track.mixer.solo;
  settingsStore.updateTrackMixer(track.title, { solo: next });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackSolo);
  } else {
    props.song?.setTrackSolo(track.mixer.index, next);
  }
}

function setTrackHighlight(track: Track | MergedTrack): void {
  const next = !track.mixer.highlight;
  settingsStore.updateTrackMixer(track.title, { highlight: next });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackHighlight);
  } else {
    props.song?.setTrackHighlight(track.mixer.index, next);
  }
}

function setTrackGain(track: Track | MergedTrack, value: number): void {
  settingsStore.updateTrackMixer(track.title, { gain: value });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackGain, value);
  } else {
    props.song?.setTrackGain(track.mixer.index, value);
  }
}

const trackFlashTriggered = ref<boolean[]>([]);

player.onNote((event) => {
  // Skip if already triggered or the track is muted
  if (trackFlashTriggered.value[event.trackIndex] || tracks.value[event.trackIndex].mixer.effectiveGain < 0.01) {
    return;
  }

  // Trigger the flash
  trackFlashTriggered.value[event.trackIndex] = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      // Reset to default state
      trackFlashTriggered.value[event.trackIndex] = false;
    });
  });
});

// Refresh track state from settings
watch(() => props.song, (song) => {
  if (!song) {
    return;
  }

  // Apply settings
  for (const metaTrack of Object.values(tracksByClassification.value).flat()) {
    const stored = settingsStore.getTrackMixer(metaTrack.title);

    const tracks = metaTrack instanceof MergedTrack ? metaTrack.tracks : [metaTrack];
    for (const track of tracks) {
      song.setTrackGain(track.mixer.index, stored.gain);
      song.setTrackMute(track.mixer.index, stored.mute);
      song.setTrackSolo(track.mixer.index, stored.solo);
      song.setTrackHighlight(track.mixer.index, stored.highlight);
    }
  }

  // Reset flash triggers
  trackFlashTriggered.value = Array(song.tracks.length).fill(false);
}, { immediate: true });

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
        v-for="trackGroup, classification in tracksByClassification"
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
                :pt:range:class="trackFlashTriggered[track.mixer.index] ? 'bg-primary transition-none' : 'bg-(--p-slider-track-background) transition-colors duration-500'"
                @update:model-value="setTrackGain(track, $event as number)"
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
