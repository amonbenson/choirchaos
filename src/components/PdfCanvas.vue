<script setup lang="ts">
import { ref, shallowRef, watch, type Ref } from "vue";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "/js/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const props = withDefaults(defineProps<{
  url: string,
  page: number,
  scale?: number,
}>(), {
  scale: 1.0,
});

const emit = defineEmits([
  "update:status",
  "ready",
]);

const canvas = ref();

const status = ref("idle");
const pdf: any = shallowRef(null);
const pageWidth: Ref<number> = ref(0);
const pageHeight: Ref<number> = ref(0);

watch(status, (value) => {
  emit("update:status", value);

  // emit ready event with pdf info
  if (value === "ready") {
    emit("ready", {
      numPages: pdf.value.numPages,
      pageWidth: pageWidth.value,
      pageHeight: pageHeight.value,
    });
  }
});

watch(() => props.url, async () => {
  // reload and draw pdf on url change
  if (props.url) {
    await load();
    await render();
  }
}, { immediate: true });

watch([() => props.page, () => props.scale], async () => {
  // re-render on page or scale change
  if (status.value === "loaded" || status.value === "ready") {
    await render();
  }
});

async function load() {
  if (!props.url) {
    status.value = "idle";
    return;
  }

  // load the pdf document
  status.value = "loading";
  const loadingTask = pdfjsLib.getDocument({
    url: props.url,
  });
  pdf.value = await loadingTask.promise;

  status.value = "loaded";
}

async function render() {
  if (!pdf.value) {
    console.warn("render() was called without a PDF file loaded!");
    return;
  }

  // setup the page and canvas context
  const page = await pdf.value.getPage(props.page + 1);
  const viewport = page.getViewport({ scale: props.scale });
  const canvasContext = canvas.value.getContext("2d");
  pageWidth.value = viewport.width;
  pageHeight.value = viewport.height;
  canvas.value.width = viewport.width;
  canvas.value.height = viewport.height;

  // invoke the render task
  const task = page.render({
    canvasContext,
    viewport,
  });
  await task.promise;

  status.value = "ready";

  // already pre-render the next page
  if (props.page < pdf.value.numPages - 1) {
    setTimeout(async () => {
      const page = await pdf.value.getPage(props.page + 2);
      const viewport = page.getViewport({ scale: props.scale });
      const dummyCanvas = document.createElement("canvas");
      const canvasContext = dummyCanvas.getContext("2d");
      const task = page.render({
        canvasContext,
        viewport,
      });
      await task.promise;
    }, 100);
  }
}

</script>

<template>
  <div
    class="absolute"
    :style="{
      width: `${pageWidth}px`,
      height: `${pageHeight}px`,
    }"
  >
    <!-- PDF canvas -->
    <canvas
      ref="canvas"
      class="relative inset-0"
    />

    <!-- Overlays -->
    <div class="absolute inset-0">
      <slot />
    </div>
  </div>
</template>
