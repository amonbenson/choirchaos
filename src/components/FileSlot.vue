<script setup lang="ts">
import { useFileDialog } from "@vueuse/core";
import Button from "primevue/button";

import { displayFilename, type UrlOrFile } from "@/core/utils/file";

const props = defineProps<{
  file?: UrlOrFile;
  icon: string;
  accept: string;
  emptyLabel: string;
  description?: string;
}>();

const emit = defineEmits<{
  select: [file: File];
  remove: [];
}>();

const { open, onChange } = useFileDialog({ accept: props.accept, multiple: false, reset: true });

onChange((files) => {
  const file = files?.[0];
  if (file) {
    emit("select", file);
  }
});
</script>

<template>
  <div class="flex items-center gap-3 rounded-md border border-(--p-content-border-color) p-2 pl-3">
    <i
      class="pi text-xl"
      :class="[icon, file ? 'text-color' : 'text-muted-color']"
    />
    <div class="min-w-0 flex-1">
      <div
        class="truncate"
        :class="file ? '' : 'text-muted-color'"
      >
        {{ file ? displayFilename(file) : emptyLabel }}
      </div>
      <div
        v-if="description"
        class="truncate text-xs text-muted-color"
      >
        {{ description }}
      </div>
    </div>
    <Button
      :label="file ? 'Replace' : 'Choose'"
      severity="secondary"
      size="small"
      text
      @click="open()"
    />
    <Button
      v-if="file"
      icon="pi pi-times"
      severity="secondary"
      size="small"
      :aria-label="`Remove ${displayFilename(file)}`"
      text
      rounded
      @click="emit('remove')"
    />
  </div>
</template>
