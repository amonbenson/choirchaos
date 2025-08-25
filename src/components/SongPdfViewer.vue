<script setup lang="ts">
import type Song from "@/core/show/song";
import PdfViewerV2 from "./PdfViewerV2.vue";
import { resolveUrl } from "@/core/utils/file";
import type p5 from "p5";
import type PageTransform from "@/core/pdf/pageTransform";

defineProps<{
  song?: Song,
}>();

function afterPageDraw({ s, p, transform }: { s: p5, p: number, transform: PageTransform }) {
}
</script>

<template>
  <PdfViewerV2
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    @after-page-draw="afterPageDraw"
  />
</template>
