<script setup lang="ts">
import type Song from "@/core/show/song";
import PdfViewerV2 from "./PdfViewerV2.vue";
import { resolveUrl } from "@/core/utils/file";
import type p5 from "p5";
import type PageTransform from "@/core/pdf/pageTransform";
import { ref } from "vue";

const props = defineProps<{
  song?: Song,
}>();

const pdfViewer = ref();

function mouseMoved({ s, transform }: { s: p5, transform: PageTransform }) {
  // redraw on mouse move
  pdfViewer.value.redraw();
}

function afterPageDraw({ s, p, transform }: { s: p5, p: number, transform: PageTransform }) {
  if (!props.song) {
    return;
  }

  // render measures
  for (const measure of props.song.measures.items()) {
    if (!measure.layout) {
      continue;
    }
    if (measure.layout.page < p) {
      continue;
    }
    if (measure.layout.page > p) {
      break; // as measure pages are in ascending order, we can break on the first out-of-range page
    }

    // transform to measure space
    s.push();
    s.translate(measure.layout.x, measure.layout.y);
    s.scale(measure.layout.width, measure.layout.height);

    s.noStroke();
    s.fill("#10b98140");
    s.rect(0, 0, 1, 1);

    s.pop();
  }
}
</script>

<template>
  <PdfViewerV2
    ref="pdfViewer"
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    @after-page-draw="afterPageDraw"
    @mouse-moved="mouseMoved"
  />
</template>
