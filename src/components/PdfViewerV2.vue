<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import p5 from "p5";
import { usePdfRendererStore } from "@/stores/pdfRenderer";
import type { PdfPageStatus } from "@/core/pdf/pdfRenderer";
import PageTransform from "@/core/pdf/pageTransform";

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
]);

const container: Ref<HTMLDivElement | undefined> = ref();

const p5Instance: ShallowRef<p5 | undefined> = shallowRef();
const sketch: ShallowRef<p5 | undefined> = shallowRef();
const resizeObserver: ShallowRef<ResizeObserver | undefined> = shallowRef();

const overlayInstance: ShallowRef<p5 | undefined> = shallowRef();
const overlaySketch: ShallowRef<p5 | undefined> = shallowRef();

const documentStatus: Ref<"none" | "loading" | "loadError" | "ready"> = ref("none");
const pages: Ref<{
  status: "none" | "rendering" | "renderError" | "ready",
  canvas?: HTMLCanvasElement,
  canvasLow?: HTMLCanvasElement,
}[]> = ref([]);

const transform: PageTransform = new PageTransform({ x: 100, y: 100 }, 750);

// update cursor immediately
watch(() => props.cursor, () => {
  if (!overlaySketch.value) {
    return;
  }

  if (props.cursor) {
    overlaySketch.value.cursor(props.cursor);
  } else if (overlaySketch.value.mouseIsPressed) {
    overlaySketch.value.cursor("grabbing");
  } else {
    overlaySketch.value.cursor("grab");
  }
});

function updateReactiveState() {
  // reset state
  if (!props.url) {
    documentStatus.value = "none";
    pages.value = [];
    return;
  }

  // update document status
  const pageZeroStatus = pdfRendererStore.getStatus(props.url, 0);
  documentStatus.value = ["none", "loading", "loadError"].includes(pageZeroStatus) ? pageZeroStatus as "none" | "loading" | "loadError" : "ready";

  // update number of pages
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
  // load all pages. The reactive state will change automatically when status update events are fired
  const currentUrl = props.url;
  if (currentUrl) {
    // laod document
    await pdfRendererStore.load(currentUrl);
    if (currentUrl !== props.url) {
      return; // cancel if url changed in the meantime
    }

    // render pages
    const numPages = pdfRendererStore.getNumPages(props.url) ?? 0;
    await Promise.all(Array(numPages).fill(null).map((_, i) => pdfRendererStore.render(currentUrl, i)));
  }
});

pdfRendererStore.onPageStatusUpdate((status: PdfPageStatus, url: string, _page: number) => {
  // update reactive statue
  if (url === props.url) {
    updateReactiveState();
    sketch.value?.redraw();
  }
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

  // check which pages are visible on screen.
  const pageRange = transform.getVisiblePageRange(s.width, pages.value.length);

  // draw pages
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

function setupOverlay() {
  const s = overlaySketch.value!;

  s.noLoop();
  handleResize();

  emit("setup", { s });
}

function drawOverlay() {
  const s = overlaySketch.value!;

  s.clear();

  // update the cursor
  if (s.mouseIsPressed) {
    s.cursor(props.cursor ?? "grabbing");
  } else {
    s.cursor(props.cursor ?? "grab");
  }

  // check which pages are visible on screen.
  const pageRange = transform.getVisiblePageRange(s.width, pages.value.length);

  // invoke overlay draw hook for each visible page
  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.pushPageTransform(s, p);
    emit("drawPageOverlay", { s, p, transform });
    s.pop();
  }
}

function mousePressed() {
  overlaySketch.value?.cursor(props.cursor ?? "grabbing");

  emit("mousePressed", { s: overlaySketch.value, transform });
}

function mouseReleased() {
  overlaySketch.value?.cursor(props.cursor ?? "grab");

  emit("mouseReleased", { s: overlaySketch.value, transform });
}

function mouseMoved() {
  emit("mouseMoved", { s: overlaySketch.value, transform });
}

function mouseDragged(event: MouseEvent) {
  const s = sketch.value!;

  // Skip if the scroll event wasn't targeted at our canvas
  if (event.target !== s.canvas && event.target !== overlaySketch.value!.canvas) {
    return;
  }

  transform.pan.x += s.movedX;
  transform.pan.y += s.movedY;

  emit("mouseDragged", { s: overlaySketch.value, transform });
  s.redraw();
  overlaySketch.value?.redraw();
}

function mouseWheel(event: WheelEvent) {
  const s = sketch.value!;

  // Skip if the scroll event wasn't targeted at our canvas
  if (event.target !== s.canvas && event.target !== overlaySketch.value!.canvas) {
    return;
  }

  if (event.metaKey) {
    // Zoom if meta key is also pressed
    const newZoom = transform.zoom * Math.exp(-0.005 * event.deltaY);
    transform.setZoom(newZoom, { x: s.mouseX, y: s.mouseY });
  } else {
    // Move the canvas
    transform.pan.x -= event.deltaX;
    transform.pan.y -= event.deltaY;
  }


  // emit("mouseWheel", { s: overlaySketch.value, transform });
  s.redraw();
  overlaySketch.value?.redraw();
}

function handleResize() {
  if (!container.value || !sketch.value || !overlaySketch.value) {
    return;
  }

  const pw = sketch.value.width;
  const ph = sketch.value.height;
  const w = container.value.clientWidth;
  const h = container.value.clientHeight;

  // update size
  sketch.value.resizeCanvas(w, h);
  overlaySketch.value.resizeCanvas(w, h);

  // keep pages in center
  if (pw > 100 && ph > 100 && w > 100 && h > 100) {
    transform.pan.x += (w - pw) / 2;
    transform.pan.y += (h - ph) / 2;
  }
}

onMounted(() => {
  // create p5 instance
  p5Instance.value = new p5((s) => {
    sketch.value = s;
    s.setup = setup;
    s.draw = draw;
  }, container.value);

  // create overlay instance
  overlayInstance.value = new p5((s) => {
    overlaySketch.value = s;
    s.setup = setupOverlay;
    s.draw = drawOverlay;
    s.mouseReleased = mouseReleased;
    s.mousePressed = mousePressed;
    s.mouseMoved = mouseMoved;
    s.mouseDragged = mouseDragged;
    s.mouseWheel = mouseWheel;
  }, container.value);

  // setup resize observer
  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container.value!);

  // initial update
  updateReactiveState();
});
onBeforeUnmount(() => {
  overlayInstance.value?.remove();
  p5Instance.value?.remove();
  resizeObserver.value?.unobserve(container.value!);
});

defineExpose({
  "redraw": () => overlaySketch.value?.redraw(),
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
}
</style>
