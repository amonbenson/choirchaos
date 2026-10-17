<script setup lang="ts">
import { useFileDialog } from "@vueuse/core";
import Button from "primevue/button";

import type { UrlOrFile } from "@/core/utils/file";

import ShowCover from "./ShowCover.vue";

const props = defineProps<{
  showId?: string;
  thumbnail?: UrlOrFile;
  compact?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  select: [file: File];
  remove: [];
}>();

const { open, onChange } = useFileDialog({ accept: "image/*", multiple: false, reset: true });

onChange((files) => {
  const file = files?.[0];
  if (file) {
    emit("select", file);
  }
});
</script>

<template>
  <ShowCover
    class="@container"
    :show-id="showId"
    :thumbnail="thumbnail"
    :icon-class="compact ? 'text-3xl' : 'text-6xl'"
  >
    <div
      v-if="!disabled"
      class="absolute right-2 bottom-2 flex gap-1"
    >
      <Button
        v-if="props.thumbnail"
        icon="pi pi-trash"
        severity="secondary"
        size="small"
        aria-label="Remove cover"
        rounded
        @click="emit('remove')"
      />
      <Button
        icon="pi pi-camera"
        :label="props.thumbnail ? 'Change cover' : 'Add cover'"
        :aria-label="props.thumbnail ? 'Change cover' : 'Add cover'"
        pt:label="hidden @[12rem]:inline"
        severity="secondary"
        size="small"
        rounded
        @click="open()"
      />
    </div>
  </ShowCover>
</template>
