<script setup lang="ts">
import Dialog from "primevue/dialog";

import type Show from "@/core/models/show";
import type Song from "@/core/models/song";

import SongDetailsForm from "./SongDetailsForm.vue";

defineProps<{
  show: Show;
}>();

const emit = defineEmits<{
  created: [song: Song];
}>();

const visible = defineModel<boolean>({ required: true });

function onSaved(song: Song): void {
  emit("created", song);
  visible.value = false;
}
</script>

<template>
  <Dialog
    v-model:visible="visible"
    header="New song"
    class="w-[36rem] max-w-[calc(100vw-2rem)]"
    modal
  >
    <SongDetailsForm
      :show="show"
      @saved="onSaved"
      @cancel="visible = false"
    />
  </Dialog>
</template>
