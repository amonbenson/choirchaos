<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import p5 from "p5";
import { usePdfRendererStore } from "@/stores/pdfRenderer";
import type { PdfPageStatus } from "@/core/pdf/pdfRenderer";

export type ReverseTransformMouse = {
  mouseX: number;
  mouseY: number;
  movedX: number;
  movedY: number;
};

const PAGE_GAP = 0.02;

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
}[]> = ref([]);

const pan: Ref<{ x: number, y: number }> = ref({ x: 100, y: 100 });
const zoom: Ref<number> = ref(750);

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
    sketch.value?.redraw();
  }
});

function setup() {
  const s = sketch.value!;

  s.noLoop();
  handleResize();

  emit("setup", { s });
}

function reverseTransformMouseViewport(s: p5): ReverseTransformMouse {
  return {
    mouseX: (s.mouseX - pan.value.x) / zoom.value,
    mouseY: (s.mouseY - pan.value.y) / zoom.value,
    movedX: s.movedX / zoom.value,
    movedY: s.movedY / zoom.value,
  };
}

function reverseTransformMousePage(s: p5, x: number): ReverseTransformMouse {
  const vp = reverseTransformMouseViewport(s);
  return {
    mouseX: (vp.mouseX - x) / Math.SQRT1_2,
    mouseY: vp.mouseY,
    movedX: vp.movedX / Math.SQRT1_2,
    movedY: vp.movedY,
  };
}

function draw() {
  const s = sketch.value!;

  s.clear();

  s.push();
  s.translate(pan.value.x, pan.value.y);
  s.scale(zoom.value);

  // update the cursor
  if (s.mouseIsPressed) {
    s.cursor("grabbing");
  } else {
    s.cursor("grab");
  }

  // check which pages are on screen. TODO: use a nice formula rather than this "brute-force" loop
  const pageRange = [-1, pages.value.length];
  for (let i = 0; i < pages.value.length; i++) {
    const x = i * (Math.SQRT1_2 + PAGE_GAP);
    const pageLeftScreen = x * zoom.value + pan.value.x;
    const pageRightScreen = (x + Math.SQRT1_2) * zoom.value + pan.value.x;
    if (pageRightScreen < 0) {
      pageRange[0] = i;
      continue;
    }
    if (pageLeftScreen > s.width) {
      pageRange[1] = i;
      break; // any following page won't be rendered, so we can use a break here
    }
  }
  pageRange[0] += 1;

  // invoke before draw hooks
  emit("beforeDraw", { s, pageRange, mouse: reverseTransformMouseViewport(s) });
  for (let i = pageRange[0]; i < pageRange[1]; i++) {
    const x = i * (Math.SQRT1_2 + PAGE_GAP);
    s.push();
    s.translate(x, 0);
    s.scale(Math.SQRT1_2, 1);

    emit("beforePageDraw", { s, page: i, mouse: reverseTransformMousePage(s, x) });

    s.pop();
  }

  // draw pages
  for (let i = pageRange[0]; i < pageRange[1]; i++) {
    const page = pages.value[i];
    const x = i * (Math.SQRT1_2 + PAGE_GAP);
    s.push();
    s.translate(x, 0);
    s.scale(Math.SQRT1_2, 1);

    if (page.status === "ready" && page.canvas) {
      s.drawingContext.drawImage(page.canvas, 0, 0, 1, 1);
    } else {
      s.fill(255);
      s.noStroke();
      s.rect(0, 0, 1, 1);
    }

    s.pop();
  }

  // invoke after draw hooks
  for (let i = pageRange[0]; i < pageRange[1]; i++) {
    const x = i * (Math.SQRT1_2 + PAGE_GAP);
    s.push();
    s.translate(x, 0);
    s.scale(Math.SQRT1_2, 1);

    emit("afterPageDraw", { s, page: i, mouse: reverseTransformMousePage(s, x) });

    s.pop();
  }
  emit("afterDraw", { s, pageRange, mouse: reverseTransformMouseViewport(s) });

  s.pop();
}

function mousePressed() {
  const s = sketch.value!;
  emit("mousePressed", { s });
  s.redraw(); // redraw required to update the cursor
}

function mouseReleased() {
  const s = sketch.value!;
  emit("mouseReleased", { s });
  s.redraw(); // redraw required to update the cursor
}

function mouseMoved() {
  const s = sketch.value!;
  emit("mouseMoved", { s });
  // redraw might be requested by the parent, but is not strictly required
}

function mouseDragged() {
  const s = sketch.value!;

  pan.value.x += s.movedX;
  pan.value.y += s.movedY;

  emit("mouseDragged", { s });
  s.redraw();
}

function mouseWheel(event: WheelEvent) {
  const s = sketch.value!;

  const zoomBefore = zoom.value;
  const zoomAfter = zoom.value * Math.exp(-0.001 * event.deltaY);

  zoom.value = zoomAfter;
  pan.value.x += (zoomBefore - zoomAfter) * (s.mouseX - pan.value.x) / zoomBefore;
  pan.value.y += (zoomBefore - zoomAfter) * (s.mouseY - pan.value.y) / zoomBefore;

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
