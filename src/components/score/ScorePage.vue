<script setup lang="ts">
import { computed } from "vue";

import type { VisiblePage } from "./PdfViewer.vue";

const props = defineProps<{
  page: VisiblePage;
}>();

const style = computed(() => ({
  left: `${props.page.x * 100}%`,
  top: `${props.page.y * 100}%`,
  width: `${props.page.width * 100}%`,
  height: `${props.page.height * 100}%`,
}));
</script>

<!-- One page of the score in the overlay. Boxes inside it are placed in fractions of the page. -->
<template>
  <div
    class="absolute"
    :style="style"
  >
    <slot />
  </div>
</template>
