<script setup lang="ts">
import { useFileDialog } from "@vueuse/core";
import { insertNodeAt, removeNode, useSortable } from "@vueuse/integrations/useSortable";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Menu from "primevue/menu";
import type { MenuItem } from "primevue/menuitem";
import Message from "primevue/message";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import { computed, nextTick, reactive, ref, useTemplateRef, watch } from "vue";

import FileSlot from "@/components/base/FileSlot.vue";
import { useDeleteSong } from "@/composables/useDeleteSong";
import { useNotify } from "@/composables/useNotify";
import { RECORDING_FILE_ACCEPT } from "@/core/import/songImport";
import type Show from "@/core/models/show";
import type Song from "@/core/models/song";
import SongDraft, { type PlaybackMode } from "@/core/models/songDraft";
import type { TrackClassification } from "@/core/models/track";
import { getNextSongNumber } from "@/core/utils/numbering";

const props = defineProps<{
  show: Show;
  song?: Song;
}>();

const emit = defineEmits<{
  saved: [song: Song, details: { created: boolean; playbackChanged: boolean }];
  deleted: [song: Song];
  cancel: [];
}>();

const deleteSongAfterAsking = useDeleteSong();
const { notifyError } = useNotify();

const PLAYBACK_OPTIONS: { label: string; value: PlaybackMode }[] = [
  { label: "None", value: "none" },
  { label: "MIDI", value: "midi" },
  { label: "Recordings", value: "audio" },
];

const VOICES: TrackClassification[] = ["Vocal", "Accompaniment", "Percussion"];

const draft = reactive(new SongDraft());
const saving = ref(false);
const submitted = ref(false);
const beatMapError = ref("");

const isNew = computed(() => !props.song);
const takenNumbers = computed(() => props.show.songs.map(song => song.number));
const errors = computed(() => submitted.value ? draft.validate(takenNumbers.value) : {});
const removedPlaybackKind = computed(() => draft.getRemovedPlaybackKind());
const tracks = computed(() => draft.getTracks());
const hasChanges = computed(() => draft.hasChanges());
const isUploadingRecordings = computed(() => saving.value && tracks.value.some(track => track.file));
const saveLabel = computed(() => {
  if (isUploadingRecordings.value) {
    return "Converting audio...";
  }

  return isNew.value ? "Create song" : "Save";
});

function resetDraft(): void {
  Object.assign(draft, new SongDraft(props.song, getNextSongNumber(takenNumbers.value)));
  submitted.value = false;
  beatMapError.value = "";
}

watch(() => props.song, resetDraft, { immediate: true });

const recordingDialog = useFileDialog({ accept: RECORDING_FILE_ACCEPT, multiple: true, reset: true });
recordingDialog.onChange((files) => {
  draft.addRecordings(Array.from(files ?? []));
});

async function selectBeatMap(file: File): Promise<void> {
  beatMapError.value = await draft.setBeatMap(file) ? "" : `"${file.name}" is not a beat map.`;
}

const trackList = useTemplateRef<HTMLElement>("trackList");
const moveMenu = useTemplateRef<InstanceType<typeof Menu>>("moveMenu");
const moveMenuIndex = ref(0);

useSortable(trackList, tracks, {
  watchElement: true,
  handle: "[data-drag-handle]",
  animation: 150,
  ghostClass: "opacity-40",
  onUpdate: ({ item, from, oldIndex, newIndex }) => {
    // Vue renders the rows from the draft, so Sortable's own DOM move is undone before the draft changes.
    removeNode(item);
    insertNodeAt(from, item, oldIndex!);
    draft.moveTrack(oldIndex!, newIndex!);
  },
});

async function moveTrack(from: number, to: number): Promise<void> {
  draft.moveTrack(from, to);
  await nextTick();
  trackList.value?.querySelectorAll<HTMLElement>("[data-drag-handle]")[to]?.focus();
}

const moveMenuItems = computed<MenuItem[]>(() => {
  const index = moveMenuIndex.value;
  return [
    { label: "Move up", icon: "pi pi-arrow-up", disabled: index === 0, command: () => moveTrack(index, index - 1) },
    { label: "Move down", icon: "pi pi-arrow-down", disabled: index === tracks.value.length - 1, command: () => moveTrack(index, index + 1) },
  ];
});

function openMoveMenu(event: MouseEvent, index: number): void {
  moveMenuIndex.value = index;
  moveMenu.value?.toggle(event);
}

async function save(): Promise<void> {
  submitted.value = true;
  if (Object.keys(draft.validate(takenNumbers.value)).length > 0 || saving.value || !hasChanges.value) {
    return;
  }

  saving.value = true;
  try {
    const { song, playbackChanged } = await draft.save(props.show.id, props.show.permissions);
    emit("saved", song, { created: isNew.value, playbackChanged });
    resetDraft();
  } catch (error) {
    notifyError("Could not save the song", error);
  } finally {
    saving.value = false;
  }
}

async function deleteSong(): Promise<void> {
  const song = props.song;
  if (song && await deleteSongAfterAsking(props.show, song)) {
    emit("deleted", song);
  }
}
</script>

<template>
  <form
    class="@container flex min-h-0 flex-col gap-4"
    @submit.prevent="save"
  >
    <div class="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
      <div class="flex gap-3">
        <div class="flex w-24 flex-col gap-2">
          <label
            for="song-number"
            class="text-sm font-medium text-muted-color"
          >No.</label>
          <InputText
            id="song-number"
            v-model="draft.number"
            class="font-mono"
            :invalid="!!errors.number"
            fluid
          />
        </div>
        <div class="flex flex-1 flex-col gap-2">
          <label
            for="song-title"
            class="text-sm font-medium text-muted-color"
          >Song title</label>
          <InputText
            id="song-title"
            v-model="draft.title"
            :invalid="!!errors.title"
            :autofocus="isNew"
            fluid
          />
        </div>
      </div>
      <Message
        v-if="errors.number || errors.title"
        severity="error"
        size="small"
        variant="simple"
        class="-mt-4"
      >
        {{ [errors.number, errors.title].filter(Boolean).join(" ") }}
      </Message>

      <div class="flex flex-col gap-2">
        <span class="text-sm font-medium text-muted-color">Score</span>
        <FileSlot
          :file="draft.score"
          icon="pi-file-pdf"
          accept=".pdf,application/pdf"
          empty-label="No score"
          file-kind="score"
          @select="draft.score = $event"
          @remove="draft.score = undefined"
        />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm font-medium text-muted-color">Playback</span>
          <SelectButton
            v-model="draft.playback"
            :options="PLAYBACK_OPTIONS"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            aria-label="Playback"
            size="small"
          />
        </div>

        <template v-if="draft.playback === 'midi'">
          <FileSlot
            :file="draft.midi"
            icon="pi-sliders-h"
            accept=".mid,.midi,audio/midi"
            empty-label="No MIDI file"
            file-kind="MIDI file"
            @select="draft.midi = $event"
            @remove="draft.midi = undefined"
          />
          <FileSlot
            :file="draft.beatMap"
            icon="pi-map"
            accept=".json,application/json"
            empty-label="No beat map"
            file-kind="beat map"
            description="Maps the MIDI file to measures and beats (.json)"
            @select="selectBeatMap"
            @remove="draft.beatMap = undefined"
          />
        </template>

        <span
          v-if="draft.playback !== 'none'"
          id="song-tracks"
          class="mt-2 text-sm font-medium text-muted-color"
        >Tracks</span>
        <div
          v-if="draft.playback !== 'none'"
          class="flex flex-col rounded-md border border-(--p-content-border-color)"
        >
          <div
            ref="trackList"
            role="list"
            aria-labelledby="song-tracks"
            class="flex flex-col"
          >
            <div
              v-for="track, i in tracks"
              :key="track.key"
              role="listitem"
              class="flex items-center gap-2 border-b border-(--p-content-border-color) bg-(--p-content-background) p-2 pl-1"
            >
              <button
                type="button"
                data-drag-handle
                class="flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-color hover:bg-(--p-content-hover-background) focus-visible:outline-2 focus-visible:outline-primary active:cursor-grabbing"
                :aria-label="`Move ${track.title}`"
                aria-haspopup="menu"
                @click="openMoveMenu($event, i)"
                @keydown.up.prevent="moveTrack(i, i - 1)"
                @keydown.down.prevent="moveTrack(i, i + 1)"
              >
                <i
                  class="pi pi-bars"
                  aria-hidden="true"
                />
              </button>
              <div class="flex min-w-0 flex-1 flex-col gap-1 @md:flex-row @md:items-center @md:gap-2">
                <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                  <InputText
                    v-if="draft.playback === 'audio'"
                    v-model="track.title"
                    size="small"
                    :invalid="!!errors.tracks && !track.title.trim()"
                    :aria-label="`Name of track ${i + 1}`"
                    placeholder="Track name"
                    fluid
                  />
                  <span
                    v-else
                    class="truncate text-sm"
                    :title="track.title"
                  >{{ track.title }}</span>
                  <span
                    v-if="track.file"
                    class="truncate text-xs text-muted-color"
                    :title="track.file.name"
                  >{{ track.file.name }}</span>
                </div>
                <div class="flex gap-2">
                  <Select
                    v-model="track.classification"
                    :options="VOICES"
                    size="small"
                    class="min-w-0 flex-1 @md:w-44 @md:flex-none"
                    :aria-label="`Voice of ${track.title}`"
                  />
                  <InputNumber
                    v-if="draft.playback === 'midi'"
                    v-model="track.program"
                    v-tooltip.top="'MIDI program'"
                    size="small"
                    class="shrink-0"
                    input-class="w-14"
                    :min="0"
                    :max="127"
                    :use-grouping="false"
                    :allow-empty="false"
                    :aria-label="`MIDI program of ${track.title}`"
                  />
                </div>
              </div>
              <Button
                icon="pi pi-times"
                severity="secondary"
                size="small"
                :aria-label="`Remove ${track.title}`"
                text
                rounded
                @click="draft.removeTrack(track)"
              />
            </div>
          </div>
          <span
            v-if="draft.playback === 'midi' && tracks.length === 0"
            class="p-3 text-sm text-muted-color"
          >The tracks are read from the beat map.</span>
          <div
            v-if="draft.playback === 'audio'"
            class="p-1"
          >
            <Button
              label="Add recordings"
              icon="pi pi-plus"
              severity="secondary"
              size="small"
              text
              fluid
              @click="recordingDialog.open()"
            />
          </div>
        </div>
        <!-- Escape would otherwise bubble up to the dialog and close it together with the menu. -->
        <Menu
          ref="moveMenu"
          :model="moveMenuItems"
          popup
          @keydown.esc.stop
        />

        <Message
          v-if="beatMapError || errors.playback || errors.tracks"
          severity="error"
          size="small"
          variant="simple"
        >
          {{ beatMapError || errors.playback || errors.tracks }}
        </Message>
        <Message
          v-if="removedPlaybackKind"
          severity="warn"
          size="small"
        >
          Saving removes the current {{ removedPlaybackKind }} of this song.
        </Message>
        <span
          v-if="draft.playback === 'midi' && tracks.length > 0"
          class="text-sm text-muted-color"
        >Track names come from the beat map. Removed tracks return when you select the beat map again.</span>
      </div>
    </div>

    <div class="flex flex-none flex-wrap items-center justify-between gap-2">
      <Button
        v-if="!isNew"
        label="Delete song"
        icon="pi pi-trash"
        severity="danger"
        text
        @click="deleteSong"
      />
      <div class="ml-auto flex gap-2">
        <Button
          label="Cancel"
          severity="secondary"
          text
          @click="emit('cancel')"
        />
        <Button
          type="submit"
          :label="saveLabel"
          :loading="saving"
          :disabled="!hasChanges"
        />
      </div>
    </div>
  </form>
</template>
