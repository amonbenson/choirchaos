<script setup lang="ts">
import type Song from "@/core/show/song";
import PdfViewerV2, { type ReverseTransformMouse } from "./PdfViewerV2.vue";
import { resolveUrl } from "@/core/utils/file";
import type p5 from "p5";

defineProps<{
  song?: Song,
}>();

function afterPageDraw({ s, page, mouse }: { s: p5, page: number, mouse: ReverseTransformMouse }) {
  if (page === 1) console.log(mouse.mouseY);
}
</script>

<template>
  <PdfViewerV2
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    @after-page-draw="afterPageDraw"
  />
</template>
