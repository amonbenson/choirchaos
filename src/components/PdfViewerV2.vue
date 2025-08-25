<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import p5 from "p5";
import { usePdfRendererStore } from "@/stores/pdfRenderer";
import type { PdfPageStatus } from "@/core/pdf/pdfRenderer";
import PageTransform from "@/core/pdf/pageTransform";

const pdfRendererStore = usePdfRendererStore();

const props = defineProps<{
  url: string | undefined,
}>();

const emit = defineEmits([
  "setup",
  "beforeDraw",
  "beforePageDraw",
  "afterPageDraw",
  "afterDraw",
  "mousePressed",
  "mouseReleased",
  "mouseMoved",
  "mouseDragged",
]);

const container: Ref<HTMLDivElement | undefined> = ref();

const p5Instance: ShallowRef<p5 | undefined> = shallowRef();
const sketch: ShallowRef<p5 | undefined> = shallowRef();
const resizeObserver: ShallowRef<ResizeObserver | undefined> = shallowRef();

const documentStatus: Ref<"none" | "loading" | "loadError" | "ready"> = ref("none");
const pages: Ref<{
  status: "none" | "rendering" | "renderError" | "ready",
  canvas?: HTMLCanvasElement,
  canvasLow?: HTMLCanvasElement,
}[]> = ref([]);

const transform: PageTransform = new PageTransform({ x: 100, y: 100 }, 750);

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

  // update the cursor
  if (s.mouseIsPressed) {
    s.cursor("grabbing");
  } else {
    s.cursor("grab");
  }

  // check which pages are visible on screen.
  const pageRange = transform.getVisiblePageRange(s.width, pages.value.length);

  // invoke before draw hooks
  transform.pushViewportTransform(s);
  emit("beforeDraw", { s, pageRange, transform });
  s.pop();

  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.pushPageTransform(s, p);
    emit("beforePageDraw", { s, p, transform });
    s.pop();
  }

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

  // invoke after draw hooks
  for (let p = pageRange[0]; p < pageRange[1]; p++) {
    transform.pushPageTransform(s, p);
    emit("afterPageDraw", { s, p, transform });
    s.pop();
  }

  transform.pushViewportTransform(s);
  emit("afterDraw", { s, pageRange, transform });
  s.pop();
}

function mousePressed() {
  const s = sketch.value!;
  emit("mousePressed", { s, transform });
  s.redraw(); // redraw required to update the cursor
}

function mouseReleased() {
  const s = sketch.value!;
  emit("mouseReleased", { s, transform });
  s.redraw(); // redraw required to update the cursor
}

function mouseMoved() {
  const s = sketch.value!;
  emit("mouseMoved", { s, transform });
  // redraw might be requested by the parent, but is not strictly required
}

function mouseDragged() {
  const s = sketch.value!;

  transform.pan.x += s.movedX;
  transform.pan.y += s.movedY;

  emit("mouseDragged", { s, transform });
  s.redraw();
}

function mouseWheel(event: WheelEvent) {
  const s = sketch.value!;

  const newZoom = transform.zoom * Math.exp(-0.001 * event.deltaY);
  transform.setZoom(newZoom, { x: s.mouseX, y: s.mouseY });

  sketch.value?.redraw();
}

function handleResize() {
  if (!sketch.value || !container.value) {
    return;
  }

  const s = sketch.value;

  s.resizeCanvas(container.value.clientWidth, container.value.clientHeight);
}

onMounted(() => {
  // create p5 instance
  p5Instance.value = new p5((s) => {
    sketch.value = s;
    s.setup = setup;
    s.draw = draw;
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
  p5Instance.value?.remove();
  resizeObserver.value?.unobserve(container.value!);
});

defineExpose({
  "redraw": () => sketch.value?.redraw(),
});
</script>

<template>
  <div
    ref="container"
    class="overflow-hidden"
  />
</template>
