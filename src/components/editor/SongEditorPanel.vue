<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints, useEventListener } from "@vueuse/core";
import Button from "primevue/button";
import { computed, ref, useId, useTemplateRef, watch } from "vue";

import CollapsiblePanel from "@/components/base/CollapsiblePanel.vue";
import MeasureDetectionForm from "@/components/editor/measures/MeasureDetectionForm.vue";
import MeasureNewBoxForm from "@/components/editor/measures/MeasureNewBoxForm.vue";
import MeasureReviewBar from "@/components/editor/measures/MeasureReviewBar.vue";
import { injectEditorSelection } from "@/composables/useEditorSelection";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import type { SongHistoryControls } from "@/composables/useSongHistory";
import { formatLocation, formatOccurrence, formatTimes } from "@/core/models/locationFormat";
import type { MeasureId } from "@/core/models/measure";
import { countOccurrences } from "@/core/models/recording";
import { formatSectionName } from "@/core/models/scoreOverlays";
import type Song from "@/core/models/song";
import { formatSyncTime } from "@/core/models/warpEditing";

import BoxesInspector from "./inspector/BoxesInspector.vue";
import MarkerInspector from "./inspector/MarkerInspector.vue";
import MeasuresInspector from "./inspector/MeasuresInspector.vue";
import PassInspector from "./inspector/PassInspector.vue";
import SectionInspector from "./inspector/SectionInspector.vue";
import SetupOverview from "./inspector/SetupOverview.vue";
import SyncPointInspector from "./inspector/SyncPointInspector.vue";

const props = defineProps<{
  song: Song | undefined;
  history: SongHistoryControls;
}>();

const emit = defineEmits<{
  openDetails: [];
}>();

const editor = injectMeasureEditor();
const { pendingBox, drawing, placeFrom, detection, reviewItems, currentReviewItem } = editor;
const selection = injectEditorSelection();
const { selected, run } = selection;
const titleId = useId();

// Below lg the panel is a bottom sheet over the score, which stays out of the way until needed.
const isSheet = useBreakpoints(breakpointsTailwind).smaller("lg");
const collapsed = ref(true);

const detecting = computed(() => !!detection.progress.value);
const hasSelection = computed(() => selected.value.kind !== "none");
const isWorking = computed(() => hasSelection.value || !!pendingBox.value || drawing.value || detecting.value);

watch(isWorking, (working) => {
  if (working) {
    collapsed.value = false;
  }
});

function formatCount(count: number): string {
  return count === 1 ? "once" : `${count} times`;
}

function label(id: MeasureId): string {
  return props.song?.findMeasure(id)?.label ?? "?";
}

type Heading = { title: string; subtitle?: string };

/** What the panel works on, and a line that tells more about it. */
function getHeading(): Heading {
  const song = props.song;
  const current = selected.value;
  if (detection.running.value) {
    return { title: "Detecting" };
  }

  if (detection.plan.value) {
    return { title: "Detection result" };
  }

  if (pendingBox.value) {
    return { title: "New measures" };
  }

  if (drawing.value) {
    return { title: "Add measures" };
  }

  if (!song) {
    return { title: "Song setup" };
  }

  switch (current.kind) {
    case "measures": {
      const [first] = current.measures;
      if (current.measures.length === 1) {
        const plays = countOccurrences(song.getTimeline(), first!.id);
        return { title: `Measure ${first!.label}`, subtitle: plays === 0 ? "The recording never plays it" : `The recording plays it ${formatCount(plays)}` };
      }

      const value = run.value;
      return value
        ? { title: `Measures ${first!.label} to ${current.measures.at(-1)!.label}`, subtitle: `${value.last - value.first + 1} measures` }
        : { title: `${current.measures.length} measures`, subtitle: "Not consecutive in the recording" };
    }

    case "boxes":
      return { title: current.boxes.length === 1 ? "Box without a number" : `${current.boxes.length} boxes without a number` };
    case "section":
      return { title: formatSectionName(song.getMeasures(), current.section), subtitle: "Section" };
    case "marker":
      return { title: `Marker ${current.marker.text}`, subtitle: `At ${formatLocation(song, current.marker.at)}` };
    case "syncPoint":
      return { title: `Sync point at ${formatLocation(song, current.warpMarker)}`, subtitle: `Starts at ${formatSyncTime(current.warpMarker.time)}` };
    case "pass": {
      const { span, occurrence, after } = current.stretch;
      const range = span.from === span.to ? label(span.from) : `${label(span.from)} to ${label(span.to)}`;
      const times = countOccurrences(song.getTimeline(), span.from) > 1 ? `, ${formatTimes(occurrence)}` : "";
      return { title: `Recording pass ${range}${times}`, subtitle: after ? `After ${formatOccurrence(label(after.measure), after.occurrence)}` : "The start of the recording" };
    }

    case "none":
      return { title: "Song setup", subtitle: "Nothing selected" };
  }
}

const heading = computed(getHeading);

const announcement = computed(() => hasSelection.value ? `${heading.value.title} selected` : "");

const showReviewBar = computed(() => !detecting.value && !pendingBox.value && !drawing.value && reviewItems.value.length > 0
  && (!hasSelection.value || !!currentReviewItem.value));

type Removable = { remove: () => void };

const reviewBar = useTemplateRef<InstanceType<typeof MeasureReviewBar>>("reviewBar");
const boxesInspector = useTemplateRef<InstanceType<typeof BoxesInspector>>("boxesInspector");
const inspector = useTemplateRef<Removable>("inspector");

const TYPED_CHARACTER = /^[0-9a-z]$/i;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && (target.isContentEditable || target.getAttribute("role") === "slider"));
}

function focusNumberField(): void {
  const field = document.getElementById(selected.value.kind === "boxes" ? "box-number" : "measure-number");
  if (field instanceof HTMLInputElement) {
    field.focus();
    field.select();
  }
}

function onReviewKey(event: KeyboardEvent): void {
  if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    if (boxesInspector.value) {
      boxesInspector.value.place();
    } else {
      reviewBar.value?.confirmCurrent();
    }
  } else if (TYPED_CHARACTER.test(event.key)) {
    // Focusing during keydown lets the browser type the key into the field, replacing its text.
    focusNumberField();
  }
}

// Keys work on the selection, so they only act while no field has the focus.
useEventListener("keydown", (event: KeyboardEvent) => {
  if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey || detecting.value) {
    return;
  }

  if (event.key === "Delete") {
    (boxesInspector.value ?? inspector.value)?.remove();
  } else if (currentReviewItem.value) {
    onReviewKey(event);
  }
});
</script>

<template>
  <section
    class="flex flex-col"
    aria-label="Editor panel"
  >
    <CollapsiblePanel
      v-model:collapsed="collapsed"
      :toggleable="isSheet"
      toggle-label="editor panel"
      header-class="py-0 pl-0"
      pt:root="flex min-h-0 flex-1 flex-col overflow-hidden max-lg:shadow-lg"
      pt:content-container="flex-1 min-h-0"
      pt:content-wrapper="flex min-h-0 flex-col"
      pt:content="flex min-h-0 flex-1 flex-col p-0"
    >
      <template #header>
        <div
          class="flex min-w-0 flex-1 items-start gap-2 py-3 pl-4"
          @click="collapsed = false"
        >
          <div class="flex min-w-0 flex-1 flex-col">
            <h2
              :id="titleId"
              class="m-0 truncate text-lg font-bold"
            >
              {{ heading.title }}
            </h2>
            <span
              v-if="heading.subtitle"
              class="truncate text-sm text-muted-color"
            >{{ heading.subtitle }}</span>
          </div>
          <Button
            v-tooltip.bottom="'Undo'"
            icon="pi pi-undo"
            severity="secondary"
            size="small"
            text
            rounded
            aria-label="Undo"
            :disabled="!history.canUndo.value"
            @click.stop="history.undo()"
          />
          <Button
            v-tooltip.bottom="'Redo'"
            icon="pi pi-undo -scale-x-100"
            severity="secondary"
            size="small"
            text
            rounded
            aria-label="Redo"
            :disabled="!history.canRedo.value"
            @click.stop="history.redo()"
          />
          <Button
            v-if="hasSelection"
            icon="pi pi-times"
            severity="secondary"
            size="small"
            text
            rounded
            aria-label="Clear selection"
            @click.stop="selection.clear()"
          />
        </div>
        <span
          class="sr-only"
          aria-live="polite"
        >{{ announcement }}</span>
      </template>

      <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <MeasureDetectionForm v-if="detecting" />

        <template v-else-if="song">
          <MeasureReviewBar
            v-if="showReviewBar"
            ref="reviewBar"
          />

          <MeasureNewBoxForm
            v-if="pendingBox"
            :layout="pendingBox"
          />
          <div
            v-else-if="drawing"
            class="flex flex-col gap-3"
          >
            <span class="text-sm">
              Drag a box around one or more measures on the score.
              <template v-if="placeFrom">The next box starts at measure {{ placeFrom }}.</template>
            </span>
            <Button
              label="Done"
              severity="secondary"
              size="small"
              class="self-start"
              @click="editor.stopDrawing()"
            />
          </div>
          <MeasuresInspector
            v-else-if="selected.kind === 'measures'"
            ref="inspector"
            :song="song"
            :measures="selected.measures"
          />
          <BoxesInspector
            v-else-if="selected.kind === 'boxes'"
            ref="boxesInspector"
            :boxes="selected.boxes"
          />
          <SectionInspector
            v-else-if="selected.kind === 'section'"
            ref="inspector"
            :song="song"
            :section="selected.section"
          />
          <MarkerInspector
            v-else-if="selected.kind === 'marker'"
            ref="inspector"
            :song="song"
            :marker="selected.marker"
          />
          <SyncPointInspector
            v-else-if="selected.kind === 'syncPoint'"
            ref="inspector"
            :song="song"
            :warp-marker="selected.warpMarker"
          />
          <PassInspector
            v-else-if="selected.kind === 'pass'"
            ref="inspector"
            :song="song"
            :index="selected.index"
            :stretch="selected.stretch"
          />
          <SetupOverview
            v-else
            :song="song"
            @open-details="emit('openDetails')"
          />
        </template>
      </div>
    </CollapsiblePanel>
  </section>
</template>
