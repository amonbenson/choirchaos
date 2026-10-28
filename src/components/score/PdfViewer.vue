<script setup lang="ts">
import { useResizeObserver } from "@vueuse/core";
import p5 from "p5";
import { onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from "vue";

import { usePanZoom } from "@/composables/usePanZoom";
import { usePdfPages } from "@/composables/usePdfPages";
import PageTransform, { type PageCoordinate } from "@/core/pdf/pageTransform";

type P5Sketch = p5 & { canvas?: HTMLCanvasElement };

export type ViewInsets = { top: number; bottom: number };

/** A page in view, in fractions of the overlay. */
export type VisiblePage = { x: number; y: number; width: number; height: number; pageNumber: number };

// Below this many pages in view each page is drawn at full resolution, above it from its low resolution copy.
const MAX_FULL_RESOLUTION_PAGES = 7;

const props = withDefaults(defineProps<{
  url: string | undefined;
  /** Whether dragging pans. Overlays that use drags for themselves turn it off. */
  pannable?: boolean;
  /** Pixels at the top and bottom that controls cover, so locations there count as hidden. */
  insets?: ViewInsets;
}>(), { pannable: true, insets: () => ({ top: 0, bottom: 0 }) });

const emit = defineEmits<{
  loadingChange: [loading: boolean];
}>();

const wrapper = ref<HTMLDivElement | undefined>();
const container = ref<HTMLDivElement | undefined>();

const sketch = shallowRef<P5Sketch | undefined>();

const transform = shallowRef(new PageTransform({ x: 100, y: 100 }, 750));
const visiblePages = shallowRef<VisiblePage[]>([]);

const { pages, documentStatus } = usePdfPages(toRef(props, "url"), { onUpdate: redraw });

watch([documentStatus, pages], ([status, currentPages]) => {
  const firstPageReady = currentPages[0]?.status === "ready";
  emit("loadingChange", status === "loading" || (status === "ready" && !firstPageReady));
}, { immediate: true });

const viewUserModified = ref(false);

watch(() => props.url, () => {
  viewUserModified.value = false;
});

usePanZoom(wrapper, transform.value, {
  onRedraw: redraw,
  canPan: () => props.pannable,
  onInteract: () => {
    viewUserModified.value = true;
  },
});

function rangeArray([start, end]: [number, number]): number[] {
  return Array.from({ length: end - start }, (_, i) => i + start);
}

/** The pages in view as fractions of the canvas, which the overlays above the score are laid out in. */
function updateVisiblePages(s: p5, pageRange: [number, number]): void {
  visiblePages.value = rangeArray(pageRange).map((p) => {
    const { x, y } = transform.value.pageToScreen({ x: 0, y: 0, p });
    const { x: width, y: height } = transform.value.pageToScreen({ x: 1, y: 1, p }, true);
    return { pageNumber: p, x: x / s.width, y: y / s.height, width: width / s.width, height: height / s.height };
  });
}

function draw(): void {
  const s = sketch.value!;
  s.clear();

  const pageRange = transform.value.getVisiblePageRange(s.width, pages.value.length);
  updateVisiblePages(s, pageRange);

  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.value.pushPageTransform(s, p);

    const page = pages.value[p];
    if (page?.status === "ready") {
      const ctx = s.drawingContext as CanvasRenderingContext2D;
      const bitmap = pageRange[1] - pageRange[0] < MAX_FULL_RESOLUTION_PAGES ? page.bitmap! : page.bitmapLow!;
      ctx.drawImage(bitmap, 0, 0, 1, 1);
    } else if (page) {
      s.fill(255);
      s.noStroke();
      s.rect(0, 0, 1, 1);
    }

    s.pop();
  }
}

// Draws right away instead of through p5's redraw(), which is async and skips calls made while an
// earlier draw finishes, leaving the canvas behind the transform until the next pan.
function redraw(): void {
  if (!sketch.value?.canvas) {
    return;
  }

  sketch.value.resetMatrix();
  draw();
}

function handleResize(): void {
  if (!(container.value && sketch.value?.canvas)) {
    return;
  }

  const pw = sketch.value.width;
  const ph = sketch.value.height;
  const w = container.value.clientWidth;
  const h = container.value.clientHeight;

  sketch.value.resizeCanvas(w, h, true);

  if (!viewUserModified.value && w > 0 && h > 0) {
    fitZoom(0);
    return;
  }

  if (pw > 100 && ph > 100 && w > 100 && h > 100) {
    transform.value.pan.x += (w - pw) / 2;
    transform.value.pan.y += (h - ph) / 2;
  }

  redraw();
}

// p5 only renders. Pointer, touch and wheel input go through usePanZoom, since p5's own mouse events drift on touch devices.
onMounted(() => {
  new p5((s) => {
    sketch.value = s;
    s.setup = () => {
      s.noLoop();
      handleResize();
    };

    s.draw = draw;
  }, container.value);
});

useResizeObserver(container, handleResize);

onBeforeUnmount(() => {
  sketch.value?.remove();
});

/** The vertical band between the insets, or the whole height when the insets leave no room. */
function getUncoveredBand(h: number): { top: number; height: number } {
  const { top, bottom } = props.insets;
  const height = h - top - bottom;
  return height > 0 ? { top, height } : { top: 0, height: h };
}

function isLocationVisible(pc: PageCoordinate): boolean {
  const w = container.value?.clientWidth ?? 0;
  const h = container.value?.clientHeight ?? 0;
  if (w <= 0 || h <= 0) {
    return false;
  }

  const band = getUncoveredBand(h);
  return transform.value.contains(pc, { x: 0, y: band.top, width: w, height: band.height });
}

export type MoveToLocationOptions = Partial<{
  offsetX: number;
  offsetY: number;
  axis: "both" | "horizontal" | "vertical";
}>;

function moveToLocation(target: PageCoordinate, options: MoveToLocationOptions = {}): void {
  const w = container.value?.clientWidth ?? 0;
  const h = container.value?.clientHeight ?? 0;
  if (w <= 0 || h <= 0) {
    return;
  }

  const offsetX = options.offsetX ?? 0.5;
  const offsetY = options.offsetY ?? 0.5;
  const axis = options.axis ?? "both";

  const vc = transform.value.pageToViewport(target);

  if (["both", "horizontal"].includes(axis)) {
    transform.value.pan.x = -vc.x * transform.value.zoom + w * offsetX;
  }

  if (["both", "vertical"].includes(axis)) {
    const band = getUncoveredBand(h);
    transform.value.pan.y = -vc.y * transform.value.zoom + band.top + band.height * offsetY;
  }
}

function fitZoom(page: number): void {
  // Use container dimensions instead of s.width/s.height: p5's _renderer (which
  // backs those getters) may not exist yet when fitZoom is called during setup.
  const w = container.value?.clientWidth ?? 0;
  const h = container.value?.clientHeight ?? 0;
  if (w <= 0 || h <= 0) {
    return;
  }

  const padding = 0.95;
  const zoomByWidth = w / Math.SQRT1_2 * padding;
  const zoomByHeight = h * padding;
  transform.value.zoom = Math.min(zoomByWidth, zoomByHeight);

  moveToLocation({ p: page, x: 0.5, y: 0.5 });
  redraw();
}

defineExpose({ redraw, isLocationVisible, moveToLocation, zoomToPage: fitZoom });
</script>

<template>
  <div
    ref="wrapper"
    class="relative size-full touch-none overflow-hidden"
  >
    <div
      ref="container"
      class="absolute size-full overflow-hidden *:absolute *:inset-0 *:touch-none"
      aria-hidden="true"
      :class="pannable ? 'cursor-grab active:cursor-grabbing' : ''"
    />

    <slot
      class="absolute"
      v-bind="{ transform, visiblePages }"
    />
  </div>
</template>
