<script setup lang="ts">
import type Song from "@/core/show/song";
import PdfViewerV2 from "./PdfViewerV2.vue";
import { resolveUrl } from "@/core/utils/file";
import type p5 from "p5";
import type PageTransform from "@/core/pdf/pageTransform";
import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import type Measure from "@/core/show/measure";
import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

const props = defineProps<{
  song?: Song,
}>();

const pdfViewer = ref();
const cursor: Ref<string | undefined> = ref();

const measuresByPage: ComputedRef<{ [key: number]: Measure[] }> = computed(() => {
  if (!props.song) {
    return {};
  }

  // group measures into separate pages
  const groups: { [key: number]: Measure[] } = {};
  for (const measure of props.song.measures.items()) {
    if (measure.layout) {
      const p = measure.layout.page;
      if (!Array.isArray(groups[p])) {
        groups[p] = [];
      }
      groups[p].push(measure);
    }
  }
  return groups;
});

const hoverMeasure: Ref<Measure | undefined> = ref();

watch(() => player.position, () => {
  pdfViewer.value?.redraw();
});

function mousePressed({ s, transform }: { s: p5, transform: PageTransform }) {
  // move to selected measure
  if (hoverMeasure.value) {
    player.setMeasure(hoverMeasure.value.value);
  }
}

function mouseMoved({ s, transform }: { s: p5, transform: PageTransform }) {
  // check if we are hovering a measure
  let newHoverMeasure = undefined;
  const { p, x, y } = transform.screenToPage({ x: s.mouseX, y: s.mouseY });
  for (const measure of (measuresByPage.value[p] ?? [])) {
    const l = measure.layout!;

    // check if in bounds
    if (x >= l.x && x < l.x + l.width && y >= l.y && y < l.y + l.height) {
      newHoverMeasure = measure;
      break;
    }
  }

  // set new hover measure and redraw on change
  if (newHoverMeasure !== hoverMeasure.value) {
    hoverMeasure.value = newHoverMeasure;
    pdfViewer.value?.redraw();
  }
}

function drawPageOverlay({ s, p, transform }: { s: p5, p: number, transform: PageTransform }) {
  if (!props.song) {
    return;
  }

  // update cursor. setting it to undefined will show the default for the pdf viewport (grab)
  cursor.value = hoverMeasure.value ? "pointer" : undefined;

  s.noStroke();

  // render measures
  for (const measure of (measuresByPage.value[p] ?? [])) {
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

    const lineWidth = 0.005 / measure.layout.width;
    const lineHeight = 0.005 / measure.layout.height;

    // highlight hovering measure
    if (measure === hoverMeasure.value) {
      s.fill("#10b98122");
      s.rect(0, 0, 1, 1);
    }

    // draw playbar
    const currentMeasure = props.song.findMeasure(player.currentMeasure[0]);
    if (currentMeasure?.value === measure.value) {
      let measureProgress = 0;

      const nextMeasure = props.song.measures.items()[props.song.measures.items().indexOf(currentMeasure) + 1];
      if (nextMeasure) {
        const t0 = currentMeasure.$beatTicks[0];
        const t1 = nextMeasure.$beatTicks[0];
        measureProgress = Math.max(0, Math.min(1, (player.position - t0) / (t1 - t0)));
      }

      s.fill("#10b981ff");
      s.rect(measureProgress, 0, lineWidth, 1);
    }

    s.pop();
  }
}
</script>

<template>
  <PdfViewerV2
    ref="pdfViewer"
    :url="song?.pdfFile ? resolveUrl(song.pdfFile, 'songs', song.id) : undefined"
    :cursor="cursor"
    @draw-page-overlay="drawPageOverlay"
    @mouse-pressed="mousePressed"
    @mouse-moved="mouseMoved"
  />
</template>
