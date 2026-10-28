<script setup lang="ts">
import Dialog from "primevue/dialog";

import type Show from "@/core/models/show";
import type Song from "@/core/models/song";

import SongDetailsForm from "./SongDetailsForm.vue";

defineProps<{
  show: Show;
  song: Song;
}>();

const emit = defineEmits<{
  saved: [song: Song, details: { created: boolean; playbackChanged: boolean }];
  deleted: [song: Song];
}>();

const visible = defineModel<boolean>({ required: true });

function onSaved(song: Song, details: { created: boolean; playbackChanged: boolean }): void {
  emit("saved", song, details);
  visible.value = false;
}

function onDeleted(song: Song): void {
  visible.value = false;
  emit("deleted", song);
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="Song details"
    class="w-xl max-w-[calc(100vw-2rem)]"
    modal
  >
    <SongDetailsForm
      :show="show"
      :song="song"
      @saved="onSaved"
      @deleted="onDeleted"
      @cancel="visible = false"
    />
  </Dialog>
</template>
