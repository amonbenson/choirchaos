<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints, useEventListener } from "@vueuse/core";
import Button from "primevue/button";
import { computed, ref, useId, useTemplateRef, watch } from "vue";

import CollapsiblePanel from "@/components/base/CollapsiblePanel.vue";
import MeasureDetectionForm from "@/components/editor/measures/MeasureDetectionForm.vue";
import MeasureNewBoxForm from "@/components/editor/measures/MeasureNewBoxForm.vue";
import MeasureReviewBar from "@/components/editor/measures/MeasureReviewBar.vue";
import MeasureUnnumberedForm from "@/components/editor/measures/MeasureUnnumberedForm.vue";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import type { SongHistoryControls } from "@/composables/useSongHistory";
import { countOccurrences, findBackToBackPasses } from "@/core/models/recording";
import type Song from "@/core/models/song";

import SelectionInspector from "./inspector/SelectionInspector.vue";
import SetupOverview from "./inspector/SetupOverview.vue";

const props = defineProps<{
  song: Song | undefined;
  history: SongHistoryControls;
}>();

const emit = defineEmits<{
  openDetails: [];
}>();

const editor = injectMeasureEditor();
const { selection, selectionCount, selectedBox, selectedBoxes, selectedRun, pendingBox, tool, detection, reviewItems, currentReviewItem } = editor;
const titleId = useId();

// Below lg the panel is a bottom sheet over the score, which stays out of the way until needed.
const isSheet = useBreakpoints(breakpointsTailwind).smaller("lg");
const collapsed = ref(true);

const detecting = computed(() => !!detection.progress.value);
const isWorkingOnMeasures = computed(() => selectionCount.value > 0 || !!pendingBox.value || tool.value === "draw" || detecting.value);

watch(isWorkingOnMeasures, (working) => {
  if (working) {
    collapsed.value = false;
  }
});

function formatCount(count: number): string {
  return count === 1 ? "once" : `${count} times`;
}

function labelAt(position: number): string {
  const entry = props.song?.getTimeline()[position];
  return (entry && props.song?.findMeasure(entry.measure)?.label) ?? "?";
}

const title = computed(() => {
  if (detection.running.value) {
    return "Detecting";
  }

  if (detection.plan.value) {
    return "Detection result";
  }

  if (pendingBox.value) {
    return "New box";
  }

  if (selectedBox.value) {
    return "Box without a number";
  }

  if (selectedBoxes.value.length > 0) {
    return `${selectionCount.value} boxes`;
  }

  if (selection.value.length === 1) {
    return `Measure ${selection.value[0]!.label}`;
  }

  if (selectedRun.value) {
    return `Measures ${labelAt(selectedRun.value.first)} to ${labelAt(selectedRun.value.last)}`;
  }

  return selection.value.length > 1 ? `${selection.value.length} measures` : "Song setup";
});

const subtitle = computed(() => {
  const song = props.song;
  const run = selectedRun.value;
  if (!song || detecting.value || pendingBox.value || selectedBoxes.value.length > 0) {
    return undefined;
  }

  if (selection.value.length === 1) {
    const plays = countOccurrences(song.getTimeline(), selection.value[0]!.id);
    return plays === 0 ? "The recording never plays it" : `The recording plays it ${formatCount(plays)}`;
  }

  if (run) {
    const timeline = song.getTimeline();
    const recorded = findBackToBackPasses(timeline, { from: timeline[run.first]!, to: timeline[run.last]! }).length;
    return `${run.last - run.first + 1} measures, recorded ${formatCount(recorded)}`;
  }

  return selection.value.length > 1 ? "Not consecutive in the recording" : "Nothing selected";
});

const announcement = computed(() => selectionCount.value > 0 ? `${title.value} selected` : "");

const showReviewBar = computed(() => !detecting.value && !pendingBox.value && reviewItems.value.length > 0
  && (selectionCount.value === 0 || !!currentReviewItem.value));

const reviewBar = useTemplateRef<InstanceType<typeof MeasureReviewBar>>("reviewBar");
const selectionInspector = useTemplateRef<InstanceType<typeof SelectionInspector>>("selectionInspector");
const unnumberedForm = useTemplateRef<InstanceType<typeof MeasureUnnumberedForm>>("unnumberedForm");

const TYPED_CHARACTER = /^[0-9a-z]$/i;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && (target.isContentEditable || target.getAttribute("role") === "slider"));
}

function focusNumberField(): void {
  const field = document.getElementById(selectedBox.value ? "box-number" : "measure-number");
  if (field instanceof HTMLInputElement) {
    field.focus();
    field.select();
  }
}

function onReviewKey(event: KeyboardEvent): void {
  if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    if (selectedBox.value) {
      unnumberedForm.value?.place();
    } else {
      reviewBar.value?.confirmCurrent();
    }
  } else if (TYPED_CHARACTER.test(event.key)) {
    // Focusing during keydown lets the browser type the key into the field, replacing its text.
    focusNumberField();
  }
}

// Keys work on the score selection, so they only act while no field has the focus.
useEventListener("keydown", (event: KeyboardEvent) => {
  if (isTyping(event.target) || event.ctrlKey || event.metaKey || event.altKey || detecting.value) {
    return;
  }

  if (event.key === "Delete") {
    if (selectedBox.value) {
      unnumberedForm.value?.remove();
    } else {
      selectionInspector.value?.removeBoxes();
    }
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
              {{ title }}
            </h2>
            <span
              v-if="subtitle"
              class="truncate text-sm text-muted-color"
            >{{ subtitle }}</span>
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
            v-if="selectionCount > 0"
            icon="pi pi-times"
            severity="secondary"
            size="small"
            text
            rounded
            aria-label="Clear selection"
            @click.stop="editor.clearSelection()"
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
          <MeasureUnnumberedForm
            v-else-if="selectedBox"
            ref="unnumberedForm"
            :box="selectedBox"
          />
          <SelectionInspector
            v-else-if="selectionCount > 0"
            ref="selectionInspector"
            :song="song"
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
