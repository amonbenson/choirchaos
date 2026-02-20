<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import p5 from "p5";
import { usePdfRendererStore } from "@/stores/pdfRenderer";
import type { PdfPageStatus } from "@/core/pdf/pdfRenderer";
import PageTransform, { type PageCoordinate } from "@/core/pdf/pageTransform";

type P5Sketch = p5 & { canvas?: HTMLCanvasElement };

const pdfRendererStore = usePdfRendererStore();

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
  "mouseDragged",
  "tap",
]);

const container: Ref<HTMLDivElement | undefined> = ref();

const p5Instance: ShallowRef<p5 | undefined> = shallowRef();
const sketch: ShallowRef<P5Sketch | undefined> = shallowRef();

const overlayInstance: ShallowRef<p5 | undefined> = shallowRef();
const overlaySketch: ShallowRef<P5Sketch | undefined> = shallowRef();

const documentStatus: Ref<"none" | "loading" | "loadError" | "ready"> = ref("none");
const pages: Ref<{
  status: "none" | "rendering" | "renderError" | "ready",
  canvas?: HTMLCanvasElement,
  canvasLow?: HTMLCanvasElement,
}[]> = ref([]);

const pressInitiatedOnCanvas: Ref<boolean> = ref(false);

const transform: PageTransform = new PageTransform({ x: 100, y: 100 }, 750);

function setCursor(cursor: string) {
  if (container.value) container.value.style.cursor = cursor;
}

// Update cursor when prop changes
watch(() => props.cursor, () => {
  setCursor(pressInitiatedOnCanvas.value ? (props.cursor ?? "grabbing") : (props.cursor ?? "grab"));
});

function updateReactiveState() {
  if (!props.url) {
    documentStatus.value = "none";
    pages.value = [];
    return;
  }

  const pageZeroStatus = pdfRendererStore.getStatus(props.url, 0);
  documentStatus.value = ["none", "loading", "loadError"].includes(pageZeroStatus) ? pageZeroStatus as "none" | "loading" | "loadError" : "ready";

  const numPages = pdfRendererStore.getNumPages(props.url);
  pages.value = Array(numPages).fill(null).map((_, i) => {
    const status = pdfRendererStore.getStatus(props.url!, i) as "none" | "rendering" | "renderError" | "ready";
    const pdfPage = pdfRendererStore.getRenderedPage(props.url!, i);
    return {
      status,
      canvas: pdfPage?.canvas,
      canvasLow: pdfPage?.canvasLow,
    };
  });
}

// handle pdf page updates
watch(() => props.url, async () => {
  const currentUrl = props.url;
  if (currentUrl) {
    await pdfRendererStore.load(currentUrl);
    if (currentUrl !== props.url) {
      return;
    }
    const numPages = pdfRendererStore.getNumPages(props.url) ?? 0;
    await Promise.all(Array(numPages).fill(null).map((_, i) => pdfRendererStore.render(currentUrl, i)));
  }
});

let pendingStatusUpdateId: number | undefined;
pdfRendererStore.onPageStatusUpdate((_status: PdfPageStatus, url: string, _page: number) => {
  if (url !== props.url) return;
  // Batch rapid status events into one redraw per animation frame
  if (pendingStatusUpdateId !== undefined) cancelAnimationFrame(pendingStatusUpdateId);
  pendingStatusUpdateId = requestAnimationFrame(() => {
    pendingStatusUpdateId = undefined;
    updateReactiveState();
    redrawAll();
  });
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

// ── Shared helpers ────────────────────────────────────────────────────────────

function isOnCanvas(target: EventTarget | null): boolean {
  return target === sketch.value?.canvas || target === overlaySketch.value?.canvas;
}

function getContainerPosition(clientX: number, clientY: number): { x: number, y: number } {
  const rect = container.value!.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

// ── Mouse via Pointer Events ──────────────────────────────────────────────────
// Using native pointer events instead of p5's mouse callbacks eliminates the
// stale pmouseX/pmouseY drift that occurs when p5 synthesises mouse events
// from touch input.

let lastPointerX: number | undefined;
let lastPointerY: number | undefined;

function handlePointerDown(event: PointerEvent) {
  if (event.pointerType !== "mouse" || !isOnCanvas(event.target)) return;
  pressInitiatedOnCanvas.value = true;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  setCursor(props.cursor ?? "grabbing");
  emit("mousePressed", { s: overlaySketch.value, transform });
}

function handlePointerMove(event: PointerEvent) {
  if (event.pointerType !== "mouse") return;
  const pos = getContainerPosition(event.clientX, event.clientY);
  emit("mouseMoved", { s: overlaySketch.value, transform, x: pos.x, y: pos.y });
  if (pressInitiatedOnCanvas.value && lastPointerX !== undefined && lastPointerY !== undefined) {
    transform.pan.x += event.clientX - lastPointerX;
    transform.pan.y += event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    redrawAll();
  } else {
    redrawOverlay();
  }
}

function handlePointerUp(event: PointerEvent) {
  if (event.pointerType !== "mouse" || !pressInitiatedOnCanvas.value) return;
  pressInitiatedOnCanvas.value = false;
  lastPointerX = undefined;
  lastPointerY = undefined;
  setCursor(props.cursor ?? "grab");
  emit("mouseReleased", { s: overlaySketch.value, transform });
  redrawOverlay();
}

function handleWheel(event: WheelEvent) {
  if (!isOnCanvas(event.target)) return;
  event.preventDefault();
  const pos = getContainerPosition(event.clientX, event.clientY);
  if (event.metaKey || event.ctrlKey) {
    // metaKey: macOS Cmd+scroll; ctrlKey: trackpad/mobile pinch
    transform.setZoom(transform.zoom * Math.exp(-0.005 * event.deltaY), pos);
  } else {
    transform.pan.x -= event.deltaX;
    transform.pan.y -= event.deltaY;
  }
  redrawAll();
}

// ── Touch Events (single-finger pan + two-finger pinch) ───────────────────────

let activeTouches: { id: number, x: number, y: number }[] = [];
let tapStart: { id: number, x: number, y: number } | undefined;
const TAP_MAX_MOVEMENT = 10;

function handleTouchStart(event: TouchEvent) {
  event.preventDefault();
  if (event.touches.length === 1) {
    pressInitiatedOnCanvas.value = true;
    const t = event.touches[0];
    tapStart = { id: t.identifier, x: t.clientX, y: t.clientY };
    setCursor("grabbing");
  } else {
    tapStart = undefined;
  }
  activeTouches = Array.from(event.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
}

function handleTouchMove(event: TouchEvent) {
  event.preventDefault();
  if (event.touches.length === 1 && pressInitiatedOnCanvas.value) {
    const touch = event.touches[0];
    const prev = activeTouches.find(t => t.id === touch.identifier);
    if (prev) {
      transform.pan.x += touch.clientX - prev.x;
      transform.pan.y += touch.clientY - prev.y;
      if (tapStart && Math.hypot(touch.clientX - tapStart.x, touch.clientY - tapStart.y) > TAP_MAX_MOVEMENT) {
        tapStart = undefined;
      }
    }
    redrawAll();
  } else if (event.touches.length === 2) {
    tapStart = undefined;
    const [t1, t2] = Array.from(event.touches);
    const prevT1 = activeTouches.find(t => t.id === t1.identifier);
    const prevT2 = activeTouches.find(t => t.id === t2.identifier);
    if (prevT1 && prevT2) {
      const prevDist = Math.hypot(prevT2.x - prevT1.x, prevT2.y - prevT1.y);
      const currDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const prevCenter = getContainerPosition((prevT1.x + prevT2.x) / 2, (prevT1.y + prevT2.y) / 2);
      const currCenter = getContainerPosition((t1.clientX + t2.clientX) / 2, (t1.clientY + t2.clientY) / 2);
      if (prevDist > 0) {
        // Zoom around the previous centroid, then pan it to the current centroid
        transform.setZoom(transform.zoom * (currDist / prevDist), prevCenter);
        transform.pan.x += currCenter.x - prevCenter.x;
        transform.pan.y += currCenter.y - prevCenter.y;
      }
    }
    redrawAll();
  }
  activeTouches = Array.from(event.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
}

function handleTouchEnd(event: TouchEvent) {
  event.preventDefault();
  if (tapStart) {
    const changed = Array.from(event.changedTouches).find(t => t.identifier === tapStart!.id);
    if (changed && Math.hypot(changed.clientX - tapStart.x, changed.clientY - tapStart.y) <= TAP_MAX_MOVEMENT) {
      emit("tap", { ...getContainerPosition(changed.clientX, changed.clientY), transform });
    }
    tapStart = undefined;
  }
  if (event.touches.length === 0) {
    pressInitiatedOnCanvas.value = false;
    setCursor("grab");
  }
  activeTouches = Array.from(event.touches).map(t => ({ id: t.identifier, x: t.clientX, y: t.clientY }));
}

onMounted(() => {
  // P5 instances are used for rendering only — all interaction is handled by
  // native pointer/touch/wheel listeners below to avoid p5's mouse-event
  // synthesis causing drift on touch devices.
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

  container.value!.addEventListener("pointerdown", handlePointerDown);
  container.value!.addEventListener("pointermove", handlePointerMove);
  container.value!.addEventListener("pointerup", handlePointerUp);
  container.value!.addEventListener("pointercancel", handlePointerUp);
  container.value!.addEventListener("wheel", handleWheel, { passive: false });
  container.value!.addEventListener("touchstart", handleTouchStart, { passive: false });
  container.value!.addEventListener("touchmove", handleTouchMove, { passive: false });
  container.value!.addEventListener("touchend", handleTouchEnd, { passive: false });

  setCursor("grab");

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container.value!);

  updateReactiveState();
});

onBeforeUnmount(() => {
  container.value?.removeEventListener("pointerdown", handlePointerDown);
  container.value?.removeEventListener("pointermove", handlePointerMove);
  container.value?.removeEventListener("pointerup", handlePointerUp);
  container.value?.removeEventListener("pointercancel", handlePointerUp);
  container.value?.removeEventListener("wheel", handleWheel);
  container.value?.removeEventListener("touchstart", handleTouchStart);
  container.value?.removeEventListener("touchmove", handleTouchMove);
  container.value?.removeEventListener("touchend", handleTouchEnd);
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
