<script setup lang="ts">
import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from "vue";
import { resolveUrl } from "@/core/utils/file";
import Song from "@/core/show/song";
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import PdfCanvas from "@/components/PdfCanvas.vue";
import { usePlayerStore } from "@/stores/player";
import type Measure from "@/core/show/measure";
import { compareNumberings } from "@/core/utils/numbering";
import Draggable from "@/components/Draggable.vue";

const player = usePlayerStore();

const props = defineProps<{
  song?: Song,
}>();

const editing = ref(false);

const viewportRef: Ref<Element | undefined> = ref();

const pdfUrl = computed(() => props.song?.pdfFile ? resolveUrl(props.song.pdfFile, "songs", props.song.id) : undefined);
const pdfStatus = ref("idle");
const ready = computed(() => pdfStatus.value === "ready");

const numPages = ref(0);
const pageWidth = ref(0);
const pageHeight = ref(0);

const viewportScale = ref(1);
const viewportOffset = ref({ x: 0, y: 0 });

// store all measures grouped by page
const pageMeasures: ShallowRef<Measure[][]> = shallowRef([]);
function updatePageMeasures() {
  if (!ready.value || !props.song) {
    return;
  }

  // split all measures into individual pages
  pageMeasures.value = Array(numPages.value).fill(null).map(() => ([]));
  for (const measure of props.song.measures.items()) {
    if (measure.layout) {
      pageMeasures.value[measure.layout.page].push(measure);
    }
  }

  // sort each page by measure value
  for (const page of pageMeasures.value) {
    page.sort((a, b) => compareNumberings(a.value, b.value));
  }
}

// keep track of currently playing measure.
const currentMeasure: ComputedRef<Measure | undefined> = computed(() => player.ready ? props.song?.findMeasure(player.currentMeasure[0].split("-")[0]) : undefined);
const currentMeasureProgress = computed(() => currentMeasure.value && currentMeasure.value?.layout && currentMeasure.value.$beatTicks
  ? (player.position - currentMeasure.value.$beatTicks[0]) / (currentMeasure.value.$beatTicks[currentMeasure.value.beats - 1] - currentMeasure.value.$beatTicks[0]) / currentMeasure.value.beats * (currentMeasure.value.beats - 1)
  : 0);

// automatic page sync
const currentPage = ref(0);
watch(() => currentMeasure.value, () => {
  const measurePage = currentMeasure.value?.layout?.page;
  if (measurePage !== undefined) {
    currentPage.value = measurePage;
  }

  // // if this is the last measure on the page and we are playing, already switch to the next page in advance
  // if (player.playing
  //     && currentPage.value < numPages.value - 1
  //     && currentMeasure.value
  //     && currentMeasure.value.value === Object.values(pageMeasures.value[currentPage.value] ?? {}).at(-1)?.value) {
  //   currentPage.value++;
  // }
});

function handleCanvasReady(event: any) {
  numPages.value = event.numPages;
  pageWidth.value = event.pageWidth;
  pageHeight.value = event.pageHeight;

  updatePageMeasures();
  fitViewport();
}

function handleViewportDrag(event: any) {
  viewportOffset.value.x += event.delta.x;
  viewportOffset.value.y += event.delta.y;
}

function handleViewportWheel(event: WheelEvent) {
  viewportScale.value *= Math.exp(event.deltaY * -0.001);
}

function fitViewport() {
  const scale = Math.min(viewportRef.value!.clientWidth / pageWidth.value, viewportRef.value!.clientHeight / pageHeight.value) * 0.95;

  viewportOffset.value = { x: 0, y: 0 };
  viewportScale.value = scale;
}

function zoomViewportIn() {
  viewportScale.value *= 1.2;
}

function zoomViewportOut() {
  viewportScale.value /= 1.2;
}

// EDITOR SPECIFIC STUFF

const editorPlane = ref();

type StaffType = {
  x: number;
  y: number;
  width: number;
  height: number;
}

const editStaff: Ref<StaffType | undefined> = ref();

function handleEditorDragStart(event: any) {
  // start a new edit staff
  const t = event.target as Element;
  editStaff.value = {
    x: event.start.x / t.clientWidth,
    y: event.start.y / t.clientHeight,
    width: 0,
    height: 0,
  };
}

function handleEditorDrag(event: any) {
  if (!editStaff.value) {
    return;
  }

  // update the staff size
  const t = event.target as Element;
  editStaff.value.width = event.end.x / t.clientWidth - editStaff.value.x;
  editStaff.value.height = event.end.y / t.clientHeight - editStaff.value.y;
}

function handleEditorDragEnd(_event: any) {
  if (!editStaff.value || !props.song) {
    return;
  }

  // ask the user how many measures to insert
  const input = prompt("Number of measures to insert:");
  const numMeasures = parseInt(input ?? "");

  // cancel on invalid input
  if (!Number.isFinite(numMeasures) || numMeasures < 1 || numMeasures > 100) {
    editStaff.value = undefined;
    return;
  }

  // generate measure layouts
  const layouts = [];
  for (let i = 0; i < numMeasures; i++) {
    layouts.push({
      page: currentPage.value ?? 0,
      x: editStaff.value.x + i * editStaff.value.width / numMeasures,
      y: editStaff.value.y,
      width: editStaff.value.width / numMeasures,
      height: editStaff.value.height,
    });
  }

  // apply measure layouts in order to all empty measures
  let l = 0;
  for (const measure of props.song.measures.items()) {
    if (!measure.layout) {
      // skip if measure is a repeat (it will receive no layout)
      if (measure.value.includes("-") && !measure.value.endsWith("-1")) {
        continue;
      }

      // stop if all layouts were placed
      if (l >= layouts.length) {
        break;
      }

      // set the layout
      measure.layout = layouts[l];

      l++;
    }
  }

  // clear edit staff and update
  editStaff.value = undefined;
  updatePageMeasures();
}

type HandleDirection = "top" | "right" | "bottom" | "left";

function isSimilar(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

function handleMeasureDrag(event: any, measure: Measure, handle: HandleDirection) {
  const dx = event.delta.x / editorPlane.value!.clientWidth / viewportScale.value;
  const dy = event.delta.y / editorPlane.value!.clientHeight / viewportScale.value;

  // find related measures
  const samePageMeasures = Object.values(pageMeasures.value[measure.layout!.page] ?? {});
  const sameStaffMeasures = samePageMeasures.filter(other => isSimilar(other.layout!.y, measure.layout!.y) && isSimilar(other.layout!.y + other.layout!.height, measure.layout!.y + other.layout!.height));

  switch (handle) {
    case "top":
      sameStaffMeasures.forEach(measure => {
        measure.layout!.y += dy;
        measure.layout!.height -= dy;
      });
      break;
    case "bottom":
      sameStaffMeasures.forEach(measure => {
        measure.layout!.height += dy;
      });
      break;
    case "left":
      const left = sameStaffMeasures[sameStaffMeasures.indexOf(measure) - 1] ?? null;
      if (left) {
        left.layout!.width += dx;
      }
      measure.layout!.x += dx;
      measure.layout!.width -= dx;
      break;
    case "right":
      const right = sameStaffMeasures[sameStaffMeasures.indexOf(measure) + 1] ?? null;
      measure.layout!.width += dx;
      if (right) {
        right.layout!.x += dx;
        right.layout!.width -= dx;
      }
      break;
    default:
      break;
  }
}

function clearMeasureLayout(measure: Measure) {
  measure.layout = undefined;
  updatePageMeasures();
}

async function uploadMeasureLayout() {
  await props.song?.update();
  console.log("Update successful");
}

</script>

<template>
  <div>
    <Draggable
      v-slot="{ passRef, dragState }"
      @drag="handleViewportDrag($event)"
    >
      <div
        :ref="ref => { passRef(ref); viewportRef = ref as HTMLElement; }"
        class="relative size-full overflow-hidden group/viewport"
        :class="dragState.active ? 'cursor-grabbing' : 'cursor-grab'"
        @wheel="handleViewportWheel($event)"
      >
        <PdfCanvas
          v-if="pdfUrl"
          class="absolute left-1/2 top-1/2"
          :class="{
            'hidden': !ready,
            'cursor-crosshair': editing,
          }"
          :style="{
            'transform': `translate(calc(${viewportOffset.x}px - 50%), calc(${viewportOffset.y}px - 50%)) scale(${viewportScale})`
          }"
          :url="pdfUrl"
          :page="currentPage"
          :scale="2"
          @update:status="pdfStatus = $event"
          @ready="handleCanvasReady($event)"
        >
          <!-- Editor plane -->
          <Draggable
            v-if="editing"
            v-slot="{ passRef }"
            @dragstart="handleEditorDragStart($event)"
            @drag="handleEditorDrag($event)"
            @dragend="handleEditorDragEnd($event)"
          >
            <div
              :ref="ref => { passRef(ref); editorPlane = ref; }"
              class="absolute inset-0 pointer-events-auto"
            >
              <div
                v-if="editStaff"
                class="absolute bg-primary/25 border-primary border-1 pointer-events-none"
                :style="{
                  left: `${editStaff.x * 100}%`,
                  top: `${editStaff.y * 100}%`,
                  width: `${editStaff.width * 100}%`,
                  height: `${editStaff.height * 100}%`,
                }"
              />
            </div>
          </Draggable>

          <!-- Measure boxes -->
          <template
            v-for="measure in Object.values(pageMeasures[currentPage] ?? {})"
            :key="measure.value"
          >
            <div
              v-if="measure.layout"
              class="absolute transition-colors group/measure pointer-events-auto"
              :class="{
                'bg-primary/0 hover:bg-primary/25 cursor-pointer': !editing,
                'bg-primary/25 border-primary border-1 cursor-default': editing,
              }"
              :style="{
                left: `${measure.layout.x * 100}%`,
                top: `${measure.layout.y * 100}%`,
                width: `${measure.layout.width * 100}%`,
                height: `${measure.layout.height * 100}%`,
              }"
              @click.stop="!editing && player.setMeasure(measure.value)"
            >
              <template v-if="editing">
                <!-- Measure number -->
                <div class="absolute left-1/2 top-1/2 -translate-1/2 text-black text-2xl font-bold group-hover/measure:opacity-0 transition-opacity">
                  {{ measure.value }}
                </div>
                <Button
                  class="absolute left-1/2 top-1/2 -translate-1/2 opacity-0 group-hover/measure:opacity-100 transition-opacity"
                  icon="pi pi-trash"
                  severity="danger"
                  rounded
                  @click="clearMeasureLayout(measure)"
                />

                <!-- Resize handles -->
                <Draggable
                  v-slot="{ passRef }"
                  @drag="handleMeasureDrag($event, measure, 'top')"
                >
                  <Button
                    :ref="(c: any) => passRef(c?.$el)"
                    class="absolute left-1/2 top-0 -translate-1/2 cursor-ns-resize"
                    icon="pi pi-arrows-v"
                    severity="secondary"
                    size="small"
                    rounded
                    pt:icon:class="pointer-events-none"
                  />
                </Draggable>
                <Draggable
                  v-slot="{ passRef }"
                  @drag="handleMeasureDrag($event, measure, 'right')"
                >
                  <Button
                    :ref="(c: any) => passRef(c?.$el)"
                    class="absolute left-full top-1/2 -translate-1/2 cursor-ew-resize"
                    icon="pi pi-arrows-h"
                    severity="secondary"
                    size="small"
                    rounded
                    pt:icon:class="pointer-events-none"
                  />
                </Draggable>
                <Draggable
                  v-slot="{ passRef }"
                  @drag="handleMeasureDrag($event, measure, 'bottom')"
                >
                  <Button
                    :ref="(c: any) => passRef(c?.$el)"
                    class="absolute left-1/2 top-full -translate-1/2 cursor-ns-resize"
                    icon="pi pi-arrows-v"
                    severity="secondary"
                    size="small"
                    rounded
                    pt:icon:class="pointer-events-none"
                  />
                </Draggable>
                <Draggable
                  v-slot="{ passRef }"
                  @drag="handleMeasureDrag($event, measure, 'left')"
                >
                  <Button
                    :ref="(c: any) => passRef(c?.$el)"
                    class="absolute left-0 top-1/2 -translate-1/2 cursor-ew-resize"
                    icon="pi pi-arrows-h"
                    severity="secondary"
                    size="small"
                    rounded
                    pt:icon:class="pointer-events-none"
                  />
                </Draggable>
              </template>
            </div>
          </template>

          <!-- Playbar -->
          <div
            v-if="!editing && currentMeasure?.layout && currentMeasure.layout.page === currentPage"
            class="absolute bg-primary rounded-full shadow-[0_0_0.75rem] shadow-primary/25 w-1 -translate-x-1/2"
            :style="{
              left: `${(currentMeasure.layout.x + currentMeasureProgress * currentMeasure.layout.width) * 100}%`,
              top: `${currentMeasure.layout.y * 100}%`,
              height: `${currentMeasure.layout.height * 100}%`,
            }"
          />

          <!-- Edit button -->
          <!-- <Button
            class="absolute right-4 top-4 pointer-events-auto"
            :class="{ 'opacity-0 group-hover/viewport:opacity-100 transition-opacity': !editing }"
            :icon="`pi ${editing ? 'pi-times' : 'pi-pencil'}`"
            severity="secondary"
            rounded
            @click="editing = !editing"
          /> -->
        </PdfCanvas>

        <div
          v-if="ready"
          class="absolute left-1/2 bottom-2 -translate-x-1/2 flex justify-center items-center gap-8 bg-surface-950 rounded-full shadow-md"
        >
          <ButtonGroup>
            <Button
              icon="pi pi-expand"
              severity="secondary"
              aria-label="Fit Page to Viewport"
              rounded
              text
              @click="fitViewport()"
            />
            <Button
              icon="pi pi-search-minus"
              severity="secondary"
              aria-label="Fit Page to Viewport"
              rounded
              text
              @click="zoomViewportOut()"
            />
            <Button
              icon="pi pi-search-plus"
              severity="secondary"
              aria-label="Fit Page to Viewport"
              rounded
              text
              @click="zoomViewportIn()"
            />
          </ButtonGroup>
          <ButtonGroup>
            <Button
              :disabled="currentPage <= 0"
              icon="pi pi-chevron-left"
              severity="secondary"
              aria-label="Previous Page"
              rounded
              text
              @click="currentPage--"
            />
            <Button
              :disabled="currentPage >= numPages - 1"
              icon="pi pi-chevron-right"
              severity="secondary"
              aria-label="Next Page"
              rounded
              text
              @click="currentPage++"
            />
          </ButtonGroup>
          <ButtonGroup>
            <Button
              icon="pi pi-pencil"
              :severity="editing ? 'primary' : 'secondary'"
              aria-label="Edit Measures"
              rounded
              text
              @click="editing = !editing"
            />
            <Button
              v-if="editing"
              label="Save Changes"
              severity="secondary"
              aria-label="Save Changes"
              rounded
              text
              @click="uploadMeasureLayout()"
            />
          </ButtonGroup>
        </div>
      </div>
    </Draggable>
  </div>
</template>
