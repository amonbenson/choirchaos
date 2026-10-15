<script setup lang="ts">
import { useObjectUrl } from "@vueuse/core";
import { computed } from "vue";

import { resolveUrl, type UrlOrFile } from "@/core/utils/file";

const props = withDefaults(defineProps<{
  showId?: string;
  thumbnail?: UrlOrFile;
  iconClass?: string;
}>(), {
  showId: "",
  thumbnail: undefined,
  iconClass: "text-6xl",
});

const localFile = computed(() => props.thumbnail instanceof File ? props.thumbnail : undefined);
const localUrl = useObjectUrl(localFile);

const imageUrl = computed(() => {
  if (typeof props.thumbnail === "string") {
    return resolveUrl(props.thumbnail, "shows", props.showId);
  }

  return localUrl.value;
});
</script>

<template>
  <div
    class="relative flex aspect-square items-center justify-center overflow-hidden rounded bg-surface-200 bg-cover bg-center dark:bg-surface-800"
    :style="{ backgroundImage: imageUrl && `url(${imageUrl})` }"
  >
    <i
      v-if="!imageUrl"
      class="pi pi-book text-muted-color"
      :class="iconClass"
    />
    <slot />
  </div>
</template>
