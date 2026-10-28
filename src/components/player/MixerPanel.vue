<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Panel from "primevue/panel";
import { computed, watch } from "vue";

import type Song from "@/core/models/song";
import type Track from "@/core/models/track";
import type { TrackClassification } from "@/core/models/track";
import { useSettingsStore } from "@/stores/settings";

import TrackGainSlider from "./TrackGainSlider.vue";

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

const settingsStore = useSettingsStore();

const props = defineProps<{
  showId: string;
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

function getMembers(track: Track | MergedTrack): Track[] {
  return track instanceof MergedTrack ? track.tracks : [track];
}

function trackName(track: Track | MergedTrack): string {
  return track.title.replace(/^-*/, "");
}

function setTrackMute(track: Track | MergedTrack): void {
  const next = !track.mixer.mute;
  settingsStore.updateTrackMixer(props.showId, track.title, { mute: next });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackMute);
  } else {
    props.song?.setTrackMute(track.mixer.index, next);
  }
}

function setTrackSolo(track: Track | MergedTrack): void {
  const next = !track.mixer.solo;
  settingsStore.updateTrackMixer(props.showId, track.title, { solo: next });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackSolo);
  } else {
    props.song?.setTrackSolo(track.mixer.index, next);
  }
}

function setTrackHighlight(track: Track | MergedTrack): void {
  const next = !track.mixer.highlight;
  settingsStore.updateTrackMixer(props.showId, track.title, { highlight: next });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackHighlight);
  } else {
    props.song?.setTrackHighlight(track.mixer.index, next);
  }
}

function setTrackGain(track: Track | MergedTrack, value: number): void {
  settingsStore.updateTrackMixer(props.showId, track.title, { gain: value });

  if (track instanceof MergedTrack) {
    track.applyToEach(setTrackGain, value);
  } else {
    props.song?.setTrackGain(track.mixer.index, value);
  }
}

// Tracks are replaced when the song details are saved, so the stored mixer settings are applied again.
watch(() => [props.showId, props.song, ...(props.song?.tracks ?? [])], () => {
  const song = props.song;
  if (!song) {
    return;
  }

  for (const metaTrack of Object.values(tracksByClassification.value).flat()) {
    const stored = settingsStore.getTrackMixer(props.showId, metaTrack.title);

    for (const track of getMembers(metaTrack)) {
      song.setTrackGain(track.mixer.index, stored.gain);
      song.setTrackMute(track.mixer.index, stored.mute);
      song.setTrackSolo(track.mixer.index, stored.solo);
      song.setTrackHighlight(track.mixer.index, stored.highlight);
    }
  }
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
        label="Add playback"
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
              {{ trackName(track) }}
            </h4>
            <div
              class="flex items-center justify-stretch gap-4"
              :class="{ 'opacity-50': track.mixer.effectiveMute }"
            >
              <ButtonGroup>
                <Button
                  label="M"
                  :aria-label="`Mute ${trackName(track)}`"
                  :aria-pressed="track.mixer.mute"
                  class="w-8"
                  :severity="track.mixer.mute ? 'primary' : 'secondary'"
                  size="small"
                  @click="setTrackMute(track)"
                />
                <Button
                  label="S"
                  :aria-label="`Solo ${trackName(track)}`"
                  :aria-pressed="track.mixer.solo"
                  class="w-8"
                  :severity="track.mixer.solo ? 'warn' : 'secondary'"
                  size="small"
                  @click="setTrackSolo(track)"
                />
                <Button
                  icon="pi pi-eye"
                  :aria-label="`Highlight ${trackName(track)}`"
                  :aria-pressed="track.mixer.highlight"
                  class="w-8"
                  :severity="track.mixer.highlight ? 'info' : 'secondary'"
                  size="small"
                  @click="setTrackHighlight(track)"
                />
              </ButtonGroup>
              <TrackGainSlider
                :tracks="getMembers(track)"
                :gain="track.mixer.gain"
                :name="trackName(track)"
                @update:gain="setTrackGain(track, $event)"
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
