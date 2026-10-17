<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import Slider from "primevue/slider";
import { computed, ref, watch } from "vue";

import type Song from "@/core/models/song";
import type Track from "@/core/models/track";
import type { TrackClassification } from "@/core/models/track";
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
  editMode: boolean;
}>();

const emit = defineEmits<{
  openSongDetails: [];
}>();

const tracks = computed(() => props.song?.tracks ?? []);

const tracksByClassification = computed<Record<string, (Track | MergedTrack)[]>>(() => {
  const nonVocalTracks = tracks.value.filter(t => t.classification !== "Vocal");
  const shouldMerge = settingsStore.current.appearance.mergeAccompaniment && nonVocalTracks.length > 0;
  const accompanimentTracks = shouldMerge
    ? [new MergedTrack(nonVocalTracks, "Accompaniment (Merged)")]
    : nonVocalTracks;

  const vocalTracks = tracks.value.filter(t => t.classification === "Vocal");

  const groups: Record<string, (Track | MergedTrack)[]> = {
    Accompaniment: accompanimentTracks,
    Vocal: vocalTracks,
  };

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
  if (trackFlashTriggered.value[event.trackIndex] || (tracks.value[event.trackIndex]?.mixer.effectiveGain ?? 0) < 0.01) {
    return;
  }

  trackFlashTriggered.value[event.trackIndex] = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      trackFlashTriggered.value[event.trackIndex] = false;
    });
  });
});

const isAudioMode = computed(() => player.mode === "audio");

function trackAmplitude(track: Track | MergedTrack): number {
  const indices = track instanceof MergedTrack
    ? track.tracks.map(t => t.mixer.index)
    : [track.mixer.index];

  return Math.max(0, ...indices.map(i => player.trackAmplitudes[i] ?? 0));
}

// Tracks are replaced when the song details are saved, so the stored mixer settings are applied again.
watch(() => [props.song, ...(props.song?.tracks ?? [])], () => {
  const song = props.song;
  if (!song) {
    return;
  }

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
      v-if="editMode && song?.playerMode === 'none'"
      class="mb-4 flex flex-col items-start gap-2 border-b border-(--p-content-border-color) pb-4"
    >
      <span class="text-sm text-muted-color">This song has no MIDI file or recordings yet.</span>
      <Button
        label="Add playback..."
        icon="pi pi-file-edit"
        severity="secondary"
        size="small"
        @click="emit('openSongDetails')"
      />
    </div>

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
              <div class="relative mx-2 flex-1">
                <Slider
                  :model-value="track.mixer.gain"
                  class="w-full"
                  :min="0"
                  :max="1"
                  :step="0.001"
                  :pt:range:class="!isAudioMode && trackFlashTriggered[track.mixer.index] ? 'bg-primary transition-none' : 'bg-(--p-slider-track-background) transition-colors duration-500'"
                  pt:handle="!z-[2]"
                  @update:model-value="setTrackGain(track, $event as number)"
                />
                <div
                  v-if="isAudioMode"
                  class="pointer-events-none absolute inset-0 z-1 flex items-center"
                >
                  <div
                    class="h-0.75 rounded-full bg-primary/70 transition-none"
                    :style="{ width: `${trackAmplitude(track) * 100}%` }"
                  />
                </div>
              </div>
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
