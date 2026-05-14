<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Panel from "primevue/panel";
import Select from "primevue/select";
import Slider from "primevue/slider";
import { computed, ref, watch } from "vue";

import type Song from "@/core/models/song";
import Track, { type TrackClassification } from "@/core/models/track";
import { resolveFilename } from "@/core/utils/file";
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

const tracks = computed(() => props.song?.tracks ?? []);

const tracksByClassification = computed<Record<string, (Track | MergedTrack)[]>>(() => {
  const nonVocalTracks = tracks.value.filter(t => t.classification !== "Vocal");
  const accompanimentTracks = settingsStore.current.appearance.mergeAccompaniment
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
  if (trackFlashTriggered.value[event.trackIndex] || tracks.value[event.trackIndex].mixer.effectiveGain < 0.01) {
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

// ── Edit mode ────────────────────────────────────────────────────────────────

const CLASSIFICATIONS: TrackClassification[] = ["Vocal", "Accompaniment", "Percussion"];

const songMode = computed((): "empty" | "midi" | "mp3" => {
  if (!props.song) {
    return "empty";
  }

  if (props.song.midiFile) {
    return "midi";
  }

  if (props.song.audioFiles.length > 0) {
    return "mp3";
  }

  return "empty";
});

const pendingMode = ref<"midi" | "mp3" | null>(null);

watch(songMode, (mode) => {
  if (mode !== "empty") {
    pendingMode.value = null;
  }
});

watch(() => props.song, (song) => {
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
  pendingMode.value = null;
}, { immediate: true });

watch(songMode, (mode) => {
  if (mode !== "empty") {
    pendingMode.value = null;
  }
});

const editingMode = computed(() =>
  songMode.value !== "empty" ? songMode.value : pendingMode.value,
);

const uploading = ref(false);
const midiFileInput = ref<HTMLInputElement | null>(null);
const mp3FileInput = ref<HTMLInputElement | null>(null);

function inferTrackTitle(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function inferTrackClassification(filename: string): TrackClassification {
  const name = filename.toLowerCase();

  if (/drum|perc(ussion)?|cymbal|snare|kick|timpani|bongo|conga|tambourine/.test(name)) {
    return "Percussion";
  }

  if (/accompan|piano|instrumental|organ|guitar|bass|synth|keyboard|string|brass|wind|horn|trumpet|trombone|cello|violin|viola|harp|flute|clarinet|oboe|sax(ophone)?/.test(name)) {
    return "Accompaniment";
  }

  return "Vocal";
}

async function handleMidiUpload(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0];

  if (!file || !props.song) {
    return;
  }

  uploading.value = true;
  try {
    await props.song.uploadMidiFile(file);
    await player.load(props.song);
  } finally {
    uploading.value = false;
    if (midiFileInput.value) {
      midiFileInput.value.value = "";
    }
  }
}

async function handleMidiRemove(): Promise<void> {
  if (!props.song) {
    return;
  }

  await props.song.removeMidiFile();
  await player.load(props.song);
}

async function handleAudioUpload(event: Event): Promise<void> {
  const files = Array.from((event.target as HTMLInputElement).files ?? []);

  if (!files.length || !props.song) {
    return;
  }

  uploading.value = true;
  try {
    for (const file of files) {
      const filename = await props.song.uploadAudioFile(file);
      const title = inferTrackTitle(file.name);
      const classification = inferTrackClassification(file.name);
      await props.song.addTrack(new Track(title, classification, 0, filename));
    }

    await player.load(props.song);
  } finally {
    uploading.value = false;
    if (mp3FileInput.value) {
      mp3FileInput.value.value = "";
    }
  }
}

async function handleAudioTrackDelete(index: number): Promise<void> {
  if (!props.song) {
    return;
  }

  const filename = props.song.tracks[index]?.audioFile;

  if (filename) {
    await props.song.removeAudioFile(filename);
  } else {
    await props.song.removeTrack(index);
  }

  await player.load(props.song);
}

async function addMidiTrack(): Promise<void> {
  if (!props.song) {
    return;
  }

  await props.song.addTrack(new Track("New Track", "Vocal", 0, ""));
}

async function handleMidiTrackDelete(index: number): Promise<void> {
  if (!props.song) {
    return;
  }

  await props.song.removeTrack(index);
  await player.load(props.song);
}

async function handleTrackMoveUp(index: number): Promise<void> {
  if (!props.song || index <= 0) {
    return;
  }

  await props.song.moveTrack(index, index - 1);
}

async function handleTrackMoveDown(index: number): Promise<void> {
  if (!props.song || index >= props.song.tracks.length - 1) {
    return;
  }

  await props.song.moveTrack(index, index + 1);
}

async function handleTrackTitleChange(index: number, value: string): Promise<void> {
  if (!props.song) {
    return;
  }

  await props.song.updateTrackFields(index, { title: value });
}

async function handleTrackClassificationChange(index: number, value: TrackClassification): Promise<void> {
  if (!props.song) {
    return;
  }

  await props.song.updateTrackFields(index, { classification: value });
}

async function handleTrackProgramChange(index: number, value: number | null): Promise<void> {
  if (!props.song || value === null) {
    return;
  }

  await props.song.updateTrackFields(index, { program: value });
}
</script>

<template>
  <Panel
    header="Mixer"
    pt:root="flex flex-col"
    pt:header="flex-none"
    pt:content-container="flex-1 overflow-y-scroll mb-2"
  >
    <!-- ── Edit section ──────────────────────────────────────────── -->
    <div
      v-if="editMode && song"
      class="mb-4 flex flex-col gap-3 border-b border-(--p-content-border-color) pb-4"
    >
      <!-- Empty: choose mode -->
      <div
        v-if="!editingMode"
        class="flex flex-col gap-2"
      >
        <span class="text-sm text-muted-color">No media files. Choose a mode:</span>
        <ButtonGroup class="w-full">
          <Button
            class="flex-1"
            label="MIDI"
            severity="secondary"
            @click="pendingMode = 'midi'"
          />
          <Button
            class="flex-1"
            label="MP3"
            severity="secondary"
            @click="pendingMode = 'mp3'"
          />
        </ButtonGroup>
      </div>

      <!-- MIDI mode -->
      <template v-else-if="editingMode === 'midi'">
        <!-- MIDI file row -->
        <div class="flex flex-col gap-1">
          <span class="text-sm font-semibold">MIDI File</span>
          <div class="flex items-center gap-1">
            <span
              class="min-w-0 flex-1 truncate text-sm"
              :class="song.midiFile ? '' : 'text-muted-color italic'"
            >
              {{ song.midiFile ? resolveFilename(song.midiFile) : 'No file uploaded' }}
            </span>
            <input
              ref="midiFileInput"
              type="file"
              accept=".mid,.midi"
              class="hidden"
              @change="handleMidiUpload"
            >
            <Button
              size="small"
              severity="secondary"
              :icon="uploading ? 'pi pi-spin pi-spinner' : 'pi pi-upload'"
              :disabled="uploading"
              @click="midiFileInput?.click()"
            />
            <Button
              v-if="song.midiFile"
              size="small"
              severity="danger"
              icon="pi pi-times"
              text
              :disabled="uploading"
              @click="handleMidiRemove"
            />
          </div>
        </div>

        <!-- Track list (MIDI) -->
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-semibold">Tracks</span>
            <Button
              size="small"
              icon="pi pi-plus"
              label="Add Track"
              severity="secondary"
              text
              @click="addMidiTrack"
            />
          </div>
          <div
            v-for="track, i in song.tracks"
            :key="i"
            class="flex flex-col gap-1"
          >
            <!-- Row 1: reorder + title + delete -->
            <div class="flex items-center gap-1">
              <div class="flex flex-col">
                <Button
                  icon="pi pi-chevron-up"
                  size="small"
                  text
                  rounded
                  :disabled="i === 0"
                  @click="handleTrackMoveUp(i)"
                />
                <Button
                  icon="pi pi-chevron-down"
                  size="small"
                  text
                  rounded
                  :disabled="i === song.tracks.length - 1"
                  @click="handleTrackMoveDown(i)"
                />
              </div>
              <InputText
                size="small"
                class="min-w-0 flex-1"
                :model-value="track.title"
                @change="handleTrackTitleChange(i, ($event.target as HTMLInputElement).value)"
              />
              <Button
                icon="pi pi-trash"
                size="small"
                severity="danger"
                text
                rounded
                @click="handleMidiTrackDelete(i)"
              />
            </div>
            <!-- Row 2: classification + program number -->
            <div class="flex items-center gap-2 pl-8">
              <Select
                size="small"
                class="flex-1"
                :model-value="track.classification"
                :options="CLASSIFICATIONS"
                @update:model-value="handleTrackClassificationChange(i, $event)"
              />
              <InputNumber
                size="small"
                class="w-20 shrink-0"
                :model-value="track.program"
                :min="0"
                :max="127"
                :use-grouping="false"
                :show-buttons="false"
                @update:model-value="handleTrackProgramChange(i, $event)"
              />
            </div>
          </div>
          <span
            v-if="song.tracks.length === 0"
            class="text-sm text-muted-color italic"
          >
            Add at least one track.
          </span>
        </div>
      </template>

      <!-- MP3 mode -->
      <template v-else-if="editingMode === 'mp3'">
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-sm font-semibold">Tracks</span>
            <div class="flex shrink-0 items-center gap-1">
              <span
                v-if="uploading"
                class="pi pi-spin pi-spinner text-xs"
              />
              <input
                ref="mp3FileInput"
                type="file"
                accept="audio/*"
                multiple
                class="hidden"
                @change="handleAudioUpload"
              >
              <Button
                size="small"
                icon="pi pi-upload"
                label="Upload MP3(s)"
                severity="secondary"
                text
                :disabled="uploading"
                @click="mp3FileInput?.click()"
              />
            </div>
          </div>
          <div
            v-for="track, i in song.tracks"
            :key="i"
            class="flex items-center gap-1"
          >
            <!-- Reorder -->
            <div class="flex flex-col">
              <Button
                icon="pi pi-chevron-up"
                size="small"
                text
                rounded
                :disabled="i === 0"
                @click="handleTrackMoveUp(i)"
              />
              <Button
                icon="pi pi-chevron-down"
                size="small"
                text
                rounded
                :disabled="i === song.tracks.length - 1"
                @click="handleTrackMoveDown(i)"
              />
            </div>
            <!-- Title -->
            <InputText
              size="small"
              class="min-w-0 flex-1"
              :model-value="track.title"
              @change="handleTrackTitleChange(i, ($event.target as HTMLInputElement).value)"
            />
            <!-- Classification -->
            <Select
              size="small"
              class="w-32 shrink-0"
              :model-value="track.classification"
              :options="CLASSIFICATIONS"
              @update:model-value="handleTrackClassificationChange(i, $event)"
            />
            <!-- Filename -->
            <span
              class="max-w-20 shrink-0 truncate text-xs text-muted-color"
              :title="track.audioFile"
            >
              {{ track.audioFile }}
            </span>
            <!-- Delete -->
            <Button
              icon="pi pi-trash"
              size="small"
              severity="danger"
              text
              rounded
              @click="handleAudioTrackDelete(i)"
            />
          </div>
          <span
            v-if="song.tracks.length === 0"
            class="text-sm text-muted-color italic"
          >
            Upload MP3 files to create tracks.
          </span>
        </div>
      </template>
    </div>

    <!-- ── Mixer controls ────────────────────────────────────────── -->
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
