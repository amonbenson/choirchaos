<script setup lang="ts">
import p5 from "p5";
import { onBeforeUnmount, onMounted, ref, shallowRef, toRef, watch } from "vue";

import { usePanZoom } from "@/composables/usePanZoom";
import { usePdfPages } from "@/composables/usePdfPages";
import PageTransform, { type PageCoordinate } from "@/core/pdf/pageTransform";

type P5Sketch = p5 & { canvas?: HTMLCanvasElement };

const props = defineProps<{
  url: string | undefined;
}>();

const emit = defineEmits<{
  setup: [payload: { s: p5 }];
  drawPageOverlay: [payload: { s: p5; p: number; transform: PageTransform }];
  mousePressed: [payload: { s: p5; transform: PageTransform }];
  mouseReleased: [payload: { s: p5; transform: PageTransform }];
  mouseMoved: [payload: { s: p5; transform: PageTransform; x: number; y: number }];
  loadingChange: [loading: boolean];
}>();

const wrapper = ref<HTMLDivElement | undefined>();
const container = ref<HTMLDivElement | undefined>();

const p5Instance = shallowRef<p5 | undefined>();
const sketch = shallowRef<P5Sketch | undefined>();

const overlayInstance = shallowRef<p5 | undefined>();
const overlaySketch = shallowRef<P5Sketch | undefined>();

const transform = shallowRef(new PageTransform({ x: 100, y: 100 }, 750));
const visiblePages = shallowRef<{ x: number; y: number; width: number; height: number; pageNumber: number }[]>([]);

const { pages, documentStatus } = usePdfPages(toRef(props, "url"), { onUpdate: redrawAll });

watch([documentStatus, pages], ([status, currentPages]) => {
  const firstPageReady = currentPages[0]?.status === "ready";
  emit("loadingChange", status === "loading" || (status === "ready" && !firstPageReady));
}, { immediate: true });

const isGrabbing = ref(false);

usePanZoom(wrapper, transform.value, {
  onRedraw: redrawAll,
  panZone: container,
});

function setup(): void {
  const s = sketch.value!;
  s.noLoop();
  handleResize();
  emit("setup", { s });
}

function draw(): void {
  const s = sketch.value!;
  s.clear();

  const pageRange = transform.value.getVisiblePageRange(s.width, pages.value.length);

  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.value.pushPageTransform(s, p);

    const page = pages.value[p];
    if (!page) {
      s.pop();
      continue;
    }

    if (page.status === "ready") {
      const ctx = s.drawingContext as CanvasRenderingContext2D;
      if (pageRange[1] - pageRange[0] < 7) {
        ctx.drawImage(page.bitmap!, 0, 0, 1, 1);
      } else {
        ctx.drawImage(page.bitmapLow!, 0, 0, 1, 1);
      }
    } else {
      s.fill(255);
      s.noStroke();
      s.rect(0, 0, 1, 1);
    }

    s.pop();
  }
}

function redrawPages(): void {
  sketch.value?.redraw();
}

function redrawOverlay(): void {
  overlaySketch.value?.redraw();
}

function redrawAll(): void {
  sketch.value?.redraw();
  overlaySketch.value?.redraw();
}

function setupOverlay(): void {
  const s = overlaySketch.value!;
  s.noLoop();
  handleResize();
  emit("setup", { s });
}

function rangeArray([start, end]: [number, number]): number[] {
  return Array.from({ length: end - start }, (_, i) => i + start);
}

function drawOverlay(): void {
  const s = overlaySketch.value!;
  s.clear();

  const pageRange = transform.value.getVisiblePageRange(s.width, pages.value.length);
  visiblePages.value = rangeArray(pageRange).map((p) => {
    const { x, y } = transform.value.pageToScreen({ x: 0, y: 0, p });
    const { x: width, y: height } = transform.value.pageToScreen({ x: 1, y: 1, p }, true);
    return {
      pageNumber: p,
      x: x / s.width,
      y: y / s.height,
      width: width / s.width,
      height: height / s.height,
    };
  });

  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.value.pushPageTransform(s, p);
    emit("drawPageOverlay", { s, p, transform: transform.value });
    s.pop();
  }
}

function handleResize(): void {
  if (!(container.value && sketch.value && sketch.value.canvas && overlaySketch.value)) {
    return;
  }

  const pw = sketch.value.width;
  const ph = sketch.value.height;
  const w = container.value.clientWidth;
  const h = container.value.clientHeight;

  sketch.value.resizeCanvas(w, h);
  overlaySketch.value.resizeCanvas(w, h);

  if (pw > 100 && ph > 100 && w > 100 && h > 100) {
    transform.value.pan.x += (w - pw) / 2;
    transform.value.pan.y += (h - ph) / 2;
  }
}

// ── Mouse event API ───────────────────────────────────────────────────────────
// These propagate pointer events to parent components. Pan/zoom handling is in
// usePanZoom; these listeners exist solely to emit the interaction events.

function isOnCanvas(target: EventTarget | null): boolean {
  return target === sketch.value?.canvas || target === overlaySketch.value?.canvas;
}

function containerPos(clientX: number, clientY: number): { x: number; y: number } {
  const rect = container.value!.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function onPointerDownForEmit(e: PointerEvent): void {
  if (e.pointerType !== "mouse" || !isOnCanvas(e.target)) {
    return;
  }

  emit("mousePressed", { s: overlaySketch.value, transform: transform.value });
}

function onPointerUpForEmit(e: PointerEvent): void {
  if (e.pointerType !== "mouse") {
    return;
  }

  emit("mouseReleased", { s: overlaySketch.value, transform: transform.value });
}

function onPointerMoveForEmit(e: PointerEvent): void {
  if (e.pointerType !== "mouse") {
    return;
  }

  const pos = containerPos(e.clientX, e.clientY);
  emit("mouseMoved", { s: overlaySketch.value, transform: transform.value, x: pos.x, y: pos.y });
}

onMounted(() => {
  // P5 instances are used for rendering only — all interaction is handled by
  // native pointer/touch/wheel listeners (in usePanZoom and below) to avoid
  // p5's mouse-event synthesis causing drift on touch devices.
  p5Instance.value = new p5((s) => {
    sketch.value = s;
    s.setup = setup;
    s.draw = draw;
  }, container.value);

  overlayInstance.value = new p5((s) => {
    overlaySketch.value = s;
    s.setup = setupOverlay;
    s.draw = drawOverlay;
  }, container.value);

  container.value!.addEventListener("pointerdown", onPointerDownForEmit);
  container.value!.addEventListener("pointermove", onPointerMoveForEmit);
  container.value!.addEventListener("pointerup", onPointerUpForEmit);
  container.value!.addEventListener("pointercancel", onPointerUpForEmit);

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container.value!);
});

onBeforeUnmount(() => {
  container.value?.removeEventListener("pointerdown", onPointerDownForEmit);
  container.value?.removeEventListener("pointermove", onPointerMoveForEmit);
  container.value?.removeEventListener("pointerup", onPointerUpForEmit);
  container.value?.removeEventListener("pointercancel", onPointerUpForEmit);
  overlayInstance.value?.remove();
  p5Instance.value?.remove();
});

function isLocationVisible(pc: PageCoordinate): boolean {
  if (!overlaySketch.value) {
    return false;
  }

  return transform.value.contains(pc, overlaySketch.value.width, overlaySketch.value.height);
}

export type MoveToLocationOptions = Partial<{
  offsetX: number;
  offsetY: number;
  axis: "both" | "horizontal" | "vertical";
}>;

function moveToLocation(target: PageCoordinate, options: MoveToLocationOptions = {}): void {
  const s = overlaySketch.value;
  if (!s) {
    return;
  }

  const offsetX = options.offsetX ?? 0.5;
  const offsetY = options.offsetY ?? 0.5;
  const axis = options.axis ?? "both";

  const vc = transform.value.pageToViewport(target);

  if (["both", "horizontal"].includes(axis)) {
    transform.value.pan.x = -vc.x * transform.value.zoom + s.width * offsetX;
  }

  if (["both", "vertical"].includes(axis)) {
    transform.value.pan.y = -vc.y * transform.value.zoom + s.height * offsetY;
  }
}

function zoomToPage(page: number): void {
  const s = overlaySketch.value;
  if (!s) {
    return;
  }

  // Zoom to fit the whole page
  const padding = 0.95;
  const zoomByWidth = s.width / Math.SQRT1_2 * padding;
  const zoomByHeight = s.height * padding;
  transform.value.zoom = Math.min(zoomByWidth, zoomByHeight);

  // Move to the center of the page
  moveToLocation({ p: page, x: 0.5, y: 0.5 });
}

defineExpose({
  redrawPages: redrawPages,
  redrawOverlay: redrawOverlay,
  redrawAll: redrawAll,
  isLocationVisible: isLocationVisible,
  moveToLocation: moveToLocation,
  zoomToPage: zoomToPage,
});
</script>

<template>
  <div
    ref="wrapper"
    class="relative size-full touch-none overflow-hidden"
  >
    <div
      ref="container"
      class="pdf-canvas-container ansolute size-full overflow-hidden"
      :class="isGrabbing ? 'cursor-grabbing' : 'cursor-grab'"
      @mousedown="isGrabbing = true"
      @mouseup="isGrabbing = false"
      @mouseleave="isGrabbing = false"
      @focusout="isGrabbing = false"
    />

    <slot
      class="absolute"
      v-bind="{ transform, visiblePages }"
    />
  </div>
</template>

<style scoped>
.pdf-canvas-container > * {
  position: absolute;
  inset: 0;
  touch-action: none;
}
</style>
