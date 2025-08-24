<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import p5 from "p5";
import { usePdfRendererStore } from "@/stores/pdfRenderer";
import type { PdfPageStatus } from "@/core/pdf/pdfRenderer";

const PAGE_GAP = 0.1;

const pdfRendererStore = usePdfRendererStore();

const props = defineProps<{
  url: string | undefined,
}>();

const container: Ref<HTMLDivElement | undefined> = ref();

const p5Instance: ShallowRef = shallowRef();
const sketch: ShallowRef = shallowRef();
const resizeObserver: ShallowRef<ResizeObserver | undefined> = shallowRef();

const documentStatus: Ref<"none" | "loading" | "loadError" | "ready"> = ref("none");
const pages: Ref<{
  status: "none" | "rendering" | "renderError" | "ready",
  canvas?: HTMLCanvasElement,
}[]> = ref([]);

const pan: Ref<{ x: number, y: number }> = ref({ x: 0, y: 0 });
const zoom: Ref<number> = ref(500);

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

pdfRendererStore.onPageStatusUpdate((status: PdfPageStatus, url: string, page: number) => {
  // update reactive statue
  if (url === props.url) {
    updateReactiveState();
  }
});

function setup() {
  const s = sketch.value!;

  s.frameRate(50);
  handleResize();
}

function draw() {
  const s = sketch.value!;

  s.clear();

  s.push();
  s.translate(pan.value.x, pan.value.y);
  s.scale(zoom.value);

  // draw all pages
  for (const [i, page] of pages.value.entries()) {
    const x = i * (Math.SQRT1_2 + PAGE_GAP);

    if (page.status === "ready" && page.canvas) {
      s.drawingContext.drawImage(page.canvas, x, 0, Math.SQRT1_2, 1);
    } else {
      s.fill(255);
      s.noStroke();
      s.rect(x, 0, Math.SQRT1_2, 1);
    }
  }

  s.pop();
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
</script>

<template>
  <div
    ref="container"
    class="overflow-hidden"
  />
</template>
