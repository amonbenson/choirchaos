<script setup lang="ts">
import { computed, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { resolveUrl } from "@/core/utils/file";
import Song from "@/core/show/song";
import Button from "primevue/button";
import PdfCanvas from "@/components/PdfCanvas.vue";
import { usePlayerStore } from "@/stores/player";
import type Measure from "@/core/show/measure";
import type { MeasureNumber } from "@/core/show/measure";

const player = usePlayerStore();

const props = defineProps<{
  song?: Song,
}>();

const pdfUrl = computed(() => props.song?.pdfFile ? resolveUrl(props.song.pdfFile, "songs", props.song.id) : undefined);
const pdfStatus = ref("idle");
const ready = computed(() => pdfStatus.value === "ready");
const numPages = ref(0);

// store all measures grouped by page
const pageMeasures: ShallowRef<{ [key: MeasureNumber]: Measure }[]> = shallowRef([]);
watch(ready, () => {
  if (!ready.value || !props.song) {
    return;
  }

  // split all measures into individual pages
  pageMeasures.value = Array(numPages.value).fill(null).map(() => ({}));
  for (const measure of props.song.measures.items()) {
    if (measure.layout) {
      pageMeasures.value[measure.layout.page][measure.value] = measure;
    }
  }
});

// keep track of currently playing measure
const currentMeasure = computed(() => props.song?.findMeasure(player.currentMeasure[0]));

// automatic page sync
const currentPage = ref(0);
watch(() => currentMeasure.value, () => {
  currentPage.value = currentMeasure.value?.layout?.page ?? 0;

  // // if this is the last measure on the page and we are playing, already switch to the next page in advance
  // if (player.playing
  //     && currentPage.value < numPages.value - 1
  //     && currentMeasure.value
  //     && currentMeasure.value.value === Object.values(pageMeasures.value[currentPage.value] ?? {}).at(-1)?.value) {
  //   currentPage.value++;
  // }
});

</script>

<template>
  <div class="relative overflow-hidden">
    <PdfCanvas
      v-if="pdfUrl"
      class="absolute left-1/2 top-1/2 -translate-1/2"
      :class="{ 'hidden': !ready }"
      :url="pdfUrl"
      :page="currentPage"
      :scale="1.3"
      @update:status="pdfStatus = $event"
      @ready="numPages = $event.numPages"
    >
      <template
        v-for="measure in Object.values(pageMeasures[currentPage] ?? {})"
        :key="measure.value"
      >
        <div
          v-if="measure.layout"
          class="absolute transition-colors cursor-pointer"
          :class="{
            'bg-primary/50': measure.value === currentMeasure?.value,
            'bg-primary/0 hover:bg-primary/25': measure.value !== currentMeasure?.value,
          }"
          :style="{
            left: `calc(${measure.layout.x} * 100%)`,
            top: `calc(${measure.layout.y} * 100%)`,
            width: `calc(${measure.layout.width} * 100%)`,
            height: `calc(${measure.layout.height} * 100%)`,
          }"
          @click="player.setMeasure(measure.value)"
        />
      </template>
    </PdfCanvas>

    <div class="absolute left-1/2 bottom-2 -translate-x-1/2 flex justify-stretch items-stretch gap-1 bg-surface-950 rounded-full">
      <Button
        :disabled="!ready || currentPage <= 0"
        icon="pi pi-chevron-left"
        severity="secondary"
        aria-label="Stop"
        rounded
        text
        @click="currentPage--"
      />
      <Button
        :disabled="!ready || currentPage >= numPages - 1"
        icon="pi pi-chevron-right"
        severity="secondary"
        aria-label="Stop"
        rounded
        text
        @click="currentPage++"
      />
    </div>
  </div>
</template>
