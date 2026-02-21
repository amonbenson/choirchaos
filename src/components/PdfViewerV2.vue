<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, toRef, type Ref, type ShallowRef } from "vue";
import p5 from "p5";
import PageTransform, { type PageCoordinate } from "@/core/pdf/pageTransform";
import { usePdfPages } from "@/composables/usePdfPages";
import { usePanZoom } from "@/composables/usePanZoom";

type P5Sketch = p5 & { canvas?: HTMLCanvasElement };

const props = defineProps<{
  url: string | undefined,
  cursor?: string | undefined,
}>();

const emit = defineEmits([
  "setup",
  "drawPageOverlay",
  "mousePressed",
  "mouseReleased",
  "mouseMoved",
  "tap",
]);

const container: Ref<HTMLDivElement | undefined> = ref();

const p5Instance: ShallowRef<p5 | undefined> = shallowRef();
const sketch: ShallowRef<P5Sketch | undefined> = shallowRef();

const overlayInstance: ShallowRef<p5 | undefined> = shallowRef();
const overlaySketch: ShallowRef<P5Sketch | undefined> = shallowRef();

const transform: PageTransform = new PageTransform({ x: 100, y: 100 }, 750);

const { pages } = usePdfPages(toRef(props, "url"), { onUpdate: redrawAll });

usePanZoom(container, transform, {
  cursor: toRef(props, "cursor"),
  onRedraw: redrawAll,
  onTap: (x, y) => emit("tap", { x, y, transform }),
});

function setup() {
  const s = sketch.value!;
  s.noLoop();
  handleResize();
  emit("setup", { s });
}

function draw() {
  const s = sketch.value!;
  s.clear();

  const pageRange = transform.getVisiblePageRange(s.width, pages.value.length);

  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.pushPageTransform(s, p);

    const page = pages.value[p];
    if (page.status === "ready") {
      if (pageRange[1] - pageRange[0] < 7) {
        s.drawingContext.drawImage(page.canvas, 0, 0, 1, 1);
      } else {
        s.drawingContext.drawImage(page.canvasLow, 0, 0, 1, 1);
      }
    } else {
      s.fill(255);
      s.noStroke();
      s.rect(0, 0, 1, 1);
    }

    s.pop();
  }
}

function redrawPages() {
  sketch.value?.redraw();
}

function redrawOverlay() {
  overlaySketch.value?.redraw();
}

function redrawAll() {
  sketch.value?.redraw();
  overlaySketch.value?.redraw();
}

function setupOverlay() {
  const s = overlaySketch.value!;
  s.noLoop();
  handleResize();
  emit("setup", { s });
}

function drawOverlay() {
  const s = overlaySketch.value!;
  s.clear();

  const pageRange = transform.getVisiblePageRange(s.width, pages.value.length);

  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.pushPageTransform(s, p);
    emit("drawPageOverlay", { s, p, transform });
    s.pop();
  }
}

function handleResize() {
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
    transform.pan.x += (w - pw) / 2;
    transform.pan.y += (h - ph) / 2;
  }
}

// ── Mouse event API ───────────────────────────────────────────────────────────
// These propagate pointer events to parent components. Pan/zoom handling is in
// usePanZoom; these listeners exist solely to emit the interaction events.

function isOnCanvas(target: EventTarget | null): boolean {
  return target === sketch.value?.canvas || target === overlaySketch.value?.canvas;
}

function containerPos(clientX: number, clientY: number) {
  const rect = container.value!.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function onPointerDownForEmit(e: PointerEvent) {
  if (e.pointerType !== "mouse" || !isOnCanvas(e.target)) return;
  emit("mousePressed", { s: overlaySketch.value, transform });
}

function onPointerUpForEmit(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  emit("mouseReleased", { s: overlaySketch.value, transform });
}

function onPointerMoveForEmit(e: PointerEvent) {
  if (e.pointerType !== "mouse") return;
  const pos = containerPos(e.clientX, e.clientY);
  emit("mouseMoved", { s: overlaySketch.value, transform, x: pos.x, y: pos.y });
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
  return transform.contains(pc, overlaySketch.value.width, overlaySketch.value.height);
}

function moveToPage(page: number) {
  const s = overlaySketch.value;
  if (!s) {
    return;
  }

  const padding = 0.95;
  const zoomByWidth = s.width / Math.SQRT1_2 * padding;
  const zoomByHeight = s.height * padding;
  transform.zoom = Math.min(zoomByWidth, zoomByHeight);

  const pageCenter = transform.pageToViewport({ p: page, x: 0.5, y: 0.5 });
  transform.pan.x = -pageCenter.x * transform.zoom + s.width / 2;
  transform.pan.y = -pageCenter.y * transform.zoom + s.height / 2;

  redrawAll();
}

function moveToLocation(target: PageCoordinate, offsetX: number = 0.3, offsetY: number = 0.3) {
  const s = overlaySketch.value;
  if (!s) {
    return;
  }

  const vc = transform.pageToViewport(target);
  transform.pan.x = -vc.x * transform.zoom + s.width * offsetX;
  transform.pan.y = -vc.y * transform.zoom + s.height * offsetY;

  redrawAll();
}

defineExpose({
  "redrawPages": redrawPages,
  "redrawOverlay": redrawOverlay,
  "redrawAll": redrawAll,
  "isLocationVisible": isLocationVisible,
  "moveToPage": moveToPage,
  "moveToLocation": moveToLocation,
});
</script>

<template>
  <div
    ref="container"
    class="pdf-canvas-container relative overflow-hidden"
  />
</template>

<style scoped>
.pdf-canvas-container > * {
  position: absolute;
  inset: 0;
  touch-action: none;
}
</style>
