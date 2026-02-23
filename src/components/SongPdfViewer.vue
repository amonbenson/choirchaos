<script setup lang="ts">
import type p5 from "p5";
import { computed, type ComputedRef, type Ref, ref, watch } from "vue";

import type PageTransform from "@/core/pdf/pageTransform";
import type { PageCoordinate } from "@/core/pdf/pageTransform";
import type Measure from "@/core/show/measure";
import type { MeasureLayout } from "@/core/show/measure";
import type Song from "@/core/show/song";
import { resolveUrl } from "@/core/utils/file";
import { usePlayerStore } from "@/stores/player";

import PdfViewerV2 from "./PdfViewerV2.vue";

const player = usePlayerStore();

const props = defineProps<{
  song?: Song;
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

const highlightedTracks: ComputedRef<Set<number>> = computed(() => new Set(props.song?.tracks.flatMap((t, i) => t.mixer.highlight ? [i] : []) ?? []));

const currentPlayingMeasure: Ref<Measure | undefined> = ref();
const currentWrittenMeasure: Ref<Measure | undefined> = ref();

const hoverMeasure: Ref<Measure | undefined> = ref();

watch(() => player.position, () => {
  // Update the current measures
  currentPlayingMeasure.value = props.song?.findMeasure(player.currentMeasure[0]);
  currentWrittenMeasure.value = props.song?.findMeasure(player.currentMeasure[0], true);

  // Update the pdf viewer
  pdfViewer.value?.redrawOverlay();
});

// Move to page 0 and set current measure on song change
watch(() => props.song, () => {
  if (props.song) {
    pdfViewer.value?.zoomToPage(0);
    pdfViewer.value?.redrawAll();

    currentPlayingMeasure.value = props.song?.measures.first();
    currentWrittenMeasure.value = props.song?.measures.first();
  }
});

// Move to next page on measure change
watch(currentWrittenMeasure, () => {
  if (!pdfViewer.value) {
    return;
  }

  const layout: MeasureLayout | undefined = currentWrittenMeasure.value?.layout;
  if (!layout) {
    return;
  }

  // Move to the measure's page
  // if (current?.layout && current.layout.page !== previous?.layout?.page) {
  //   pdfViewer.value.moveToPage(current.layout.page);
  // }

  const measureTopLeft: PageCoordinate = {
    x: layout.x,
    y: layout.y,
    p: layout.page,
  };
  const measureBottomRight: PageCoordinate = {
    x: layout.x + layout.width,
    y: layout.y + layout.height,
    p: layout.page,
  };

  const isMeasureVisible = (): boolean => pdfViewer.value.isLocationVisible(measureTopLeft) && pdfViewer.value.isLocationVisible(measureBottomRight);

  // If the whole measure is within view, cancel
  if (isMeasureVisible()) {
    return;
  }

  // Get the measure's left edge
  const staffLineCenter: PageCoordinate = {
    x: 0.5,
    y: layout.y + layout.height / 2,
    p: layout.page,
  };

  // Move only the horizontal axis first. If that isn't enough, move both axes
  pdfViewer.value.moveToLocation(staffLineCenter, { axis: "horizontal" });

  // If the measure still isn't visible, move both axes
  if (!isMeasureVisible()) {
    pdfViewer.value.moveToLocation(staffLineCenter, { axis: "both" });
  }

  // If the measure still isn't visible, that means we are so zoomed in, that the full staff width doesn't fit.
  // In that case, move to the center of the measure
  if (!isMeasureVisible()) {
    pdfViewer.value.moveToLocation({
      x: layout.x + layout.width / 2,
      y: layout.y + layout.height / 2,
      p: layout.page,
    }, { axis: "both" });
  }

  pdfViewer.value.redrawAll();
});

// Redraw when track highlighting changes
watch(highlightedTracks, () => {
  pdfViewer.value?.redrawOverlay();
});

// Returns the measure at the given screen-space coordinates, or undefined if none.
function findMeasureAt(transform: PageTransform, x: number, y: number): Measure | undefined {
  const { p, x: px, y: py } = transform.screenToPage({ x, y });
  for (const measure of (measuresByPage.value[p] ?? [])) {
    if (!measure.layout) {
      continue;
    }

    const l = measure.layout;
    if (px >= l.x && px < l.x + l.width && py >= l.y && py < l.y + l.height) {
      return measure;
    }
  }

  return undefined;
}

function mousePressed(_: { s: p5; transform: PageTransform }): void {
  // move to selected measure
  if (hoverMeasure.value) {
    player.setMeasure(hoverMeasure.value.value);
  }
}

function tap({ x, y, transform }: { x: number; y: number; transform: PageTransform }): void {
  const measure = findMeasureAt(transform, x, y);
  if (measure) {
    player.setMeasure(measure.value);
  }
}

function mouseMoved({ transform, x, y }: { s: p5; transform: PageTransform; x: number; y: number }): void {
  // check if we are hovering a measure
  const newHoverMeasure = findMeasureAt(transform, x, y);

  // set new hover measure and redraw on change
  if (newHoverMeasure !== hoverMeasure.value) {
    hoverMeasure.value = newHoverMeasure;
    pdfViewer.value?.redrawOverlay();
  }
}

function isMeasureHighlighted(measure: Measure): boolean {
  for (const i of measure.$activeTrackIndices) {
    if (highlightedTracks.value.has(i)) {
      return true;
    }
  }

  return false;
}

function drawPageOverlay({ s, p }: { s: p5; p: number; transform: PageTransform }): void {
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

    // transform to measure space
    s.push();
    s.translate(measure.layout.x, measure.layout.y);
    s.scale(measure.layout.width, measure.layout.height);

    const lineWidth = 0.005 / measure.layout.width;

    // highlight hovering measure
    if (measure === hoverMeasure.value) {
      s.fill("#10b98122");
      s.rect(0, 0, 1, 1);
    }

    // highlight marked measure
    if (isMeasureHighlighted(measure)) {
      s.fill("#74d4ff44");
      s.rect(0, 0, 1, 1);
    }

    // draw playbar
    if (currentWrittenMeasure?.value?.value === measure.value && currentPlayingMeasure.value) {
      const mStart = currentPlayingMeasure.value.$beatTicks[0] ?? 0;
      const mLength = currentPlayingMeasure.value.$tickLength ?? 960;
      const measureProgress = Math.max(0, Math.min(1, (player.position - mStart) / mLength));

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
    @tap="tap"
  />
</template>
