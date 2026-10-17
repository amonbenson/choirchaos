<script setup lang="ts">
import { useFileDialog } from "@vueuse/core";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import InputText from "primevue/inputtext";
import Message from "primevue/message";
import SelectButton from "primevue/selectbutton";
import { useConfirm } from "primevue/useconfirm";
import { computed, reactive, ref, watch } from "vue";

import { useNotify } from "@/composables/useNotify";
import { RECORDING_FILE_ACCEPT } from "@/core/import/songImport";
import { isBeatMapFile } from "@/core/midi/beatMap";
import type Show from "@/core/models/show";
import type Song from "@/core/models/song";
import SongDraft, { type PlaybackMode } from "@/core/models/songDraft";
import { getNextSongNumber } from "@/core/utils/numbering";

import FileSlot from "./FileSlot.vue";

const props = defineProps<{
  show: Show;
  song?: Song;
}>();

const emit = defineEmits<{
  saved: [song: Song, details: { created: boolean; filesChanged: boolean }];
  deleted: [song: Song];
}>();

const visible = defineModel<boolean>({ required: true });

const confirm = useConfirm();
const { notifyError } = useNotify();

const PLAYBACK_OPTIONS: { label: string; value: PlaybackMode }[] = [
  { label: "None", value: "none" },
  { label: "MIDI", value: "midi" },
  { label: "Recordings", value: "audio" },
];

const draft = reactive(new SongDraft());
const saving = ref(false);
const submitted = ref(false);
const beatMapError = ref("");

const isNew = computed(() => !props.song);
const takenNumbers = computed(() => props.show.songs.map(song => song.number));
const errors = computed(() => submitted.value ? draft.validate(takenNumbers.value) : {});
const removedPlaybackKind = computed(() => draft.getRemovedPlaybackKind());
const isUploadingRecordings = computed(() => saving.value && draft.playback === "audio" && draft.newRecordings.length > 0);
const saveLabel = computed(() => {
  if (isUploadingRecordings.value) {
    return "Converting audio...";
  }

  return isNew.value ? "Create song" : "Save";
});

watch(visible, (value) => {
  if (!value) {
    return;
  }

  Object.assign(draft, new SongDraft(props.song, getNextSongNumber(takenNumbers.value)));
  submitted.value = false;
  beatMapError.value = "";
}, { immediate: true });

const recordingDialog = useFileDialog({ accept: RECORDING_FILE_ACCEPT, multiple: true, reset: true });
recordingDialog.onChange((files) => {
  draft.addRecordings(Array.from(files ?? []));
});

async function selectBeatMap(file: File): Promise<void> {
  beatMapError.value = await isBeatMapFile(file) ? "" : `"${file.name}" is not a beat map.`;
  if (!beatMapError.value) {
    draft.beatMap = file;
  }
}

async function save(): Promise<void> {
  submitted.value = true;
  if (Object.keys(draft.validate(takenNumbers.value)).length > 0 || saving.value) {
    return;
  }

  saving.value = true;
  try {
    const { song, filesChanged } = await draft.save(props.show.id, props.show.permissions);
    emit("saved", song, { created: isNew.value, filesChanged });
    visible.value = false;
  } catch (error) {
    notifyError("Could not save the song", error);
  } finally {
    saving.value = false;
  }
}

function deleteSong(): void {
  const song = props.song;
  if (!song) {
    return;
  }

  confirm.require({
    header: "Delete song",
    message: `Song ${song.number} "${song.title}" will be deleted permanently, including its score and recordings.`,
    icon: "pi pi-exclamation-triangle",
    rejectProps: { label: "Cancel", severity: "secondary", text: true },
    acceptProps: { label: "Delete song", severity: "danger" },
    accept: async () => {
      try {
        await props.show.deleteSong(song);
        emit("deleted", song);
        visible.value = false;
      } catch (error) {
        notifyError("Could not delete the song", error);
      }
    },
  });
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    :header="isNew ? 'New song' : 'Song details'"
    class="w-[36rem] max-w-[calc(100vw-2rem)]"
    modal
  >
    <form
      class="flex flex-col gap-6"
      @submit.prevent="save"
    >
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
          >Title</label>
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
            @select="draft.midi = $event"
            @remove="draft.midi = undefined"
          />
          <FileSlot
            :file="draft.beatMap"
            icon="pi-list"
            accept=".json,application/json"
            empty-label="No beat map"
            description="Maps the MIDI file to measures and beats (.json)"
            @select="selectBeatMap"
            @remove="draft.beatMap = undefined"
          />
        </template>

        <div
          v-else-if="draft.playback === 'audio'"
          class="flex flex-col rounded-md border border-(--p-content-border-color)"
        >
          <div
            v-for="recording in draft.storedRecordings"
            :key="recording.filename"
            class="flex items-center gap-3 border-b border-(--p-content-border-color) p-2 pl-3"
          >
            <i class="pi pi-volume-up text-muted-color" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ recording.title }}</span>
            <Button
              icon="pi pi-times"
              severity="secondary"
              size="small"
              :aria-label="`Remove ${recording.title}`"
              text
              rounded
              @click="draft.storedRecordings = draft.storedRecordings.filter(r => r !== recording)"
            />
          </div>
          <div
            v-for="recording in draft.newRecordings"
            :key="recording.file.name"
            class="flex items-center gap-3 border-b border-(--p-content-border-color) p-2 pl-3"
          >
            <i class="pi pi-volume-up text-primary" />
            <InputText
              v-model="recording.title"
              size="small"
              class="min-w-0 flex-1"
              :aria-label="`Track name for ${recording.file.name}`"
            />
            <span
              class="hidden max-w-32 truncate text-xs text-muted-color sm:inline"
              :title="recording.file.name"
            >{{ recording.file.name }}</span>
            <Button
              icon="pi pi-times"
              severity="secondary"
              size="small"
              :aria-label="`Remove ${recording.file.name}`"
              text
              rounded
              @click="draft.newRecordings = draft.newRecordings.filter(r => r !== recording)"
            />
          </div>
          <div class="p-1">
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

        <Message
          v-if="beatMapError || errors.playback"
          severity="error"
          size="small"
          variant="simple"
        >
          {{ beatMapError || errors.playback }}
        </Message>
        <Message
          v-if="removedPlaybackKind"
          severity="warn"
          size="small"
        >
          Saving removes the current {{ removedPlaybackKind }} of this song.
        </Message>
        <span
          v-if="draft.playback !== 'none'"
          class="text-sm text-muted-color"
        >Track names, voices and order are set in the mixer while editing in the player.</span>
      </div>
    </form>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-between gap-2">
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
            @click="visible = false"
          />
          <Button
            :label="saveLabel"
            :loading="saving"
            @click="save"
          />
        </div>
      </div>
    </template>
  </Dialog>
</template>
