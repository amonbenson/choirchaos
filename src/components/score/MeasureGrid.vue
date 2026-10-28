<script setup lang="ts">
import { onLongPress } from "@vueuse/core";
import { computed, useId, useTemplateRef, watch } from "vue";

import { getClickIntent, injectEditorSelection } from "@/composables/useEditorSelection";
import type Measure from "@/core/models/measure";
import { isMeasureSelected } from "@/core/models/selection";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{
  song: Song;
  editMode: boolean;
  /** Pixels at the bottom that a panel covers, such as the inspector's bottom sheet. */
  coveredBottom?: number;
}>();

const player = usePlayerStore();
const editorSelection = injectEditorSelection();
const { selection, touchMultiSelect } = editorSelection;
const titleId = useId();
const list = useTemplateRef<HTMLElement>("list");

const playingId = computed(() => player.currentLocation?.measure);

let lastPointerType = "mouse";
let suppressNextClick = false;

function rememberPointerType(event: PointerEvent): void {
  lastPointerType = event.pointerType;
}

function isSelected(measure: Measure): boolean {
  return props.editMode && isMeasureSelected(selection.value, measure.id);
}

/** A click always moves the playhead to the measure's first pass. In edit mode it also selects, like a box on the score. */
function onClick(event: MouseEvent, measure: Measure): void {
  if (suppressNextClick) {
    suppressNextClick = false;
    return;
  }

  if (props.editMode) {
    editorSelection.clickMeasure(measure.id, getClickIntent(event, lastPointerType, touchMultiSelect.value));
    if (!isMeasureSelected(selection.value, measure.id)) {
      return;
    }
  }

  player.seekLocation({ measure: measure.id, occurrence: 1, beat: 0 });
}

function findMeasureAt(target: EventTarget | null): Measure | undefined {
  const id = (target as Element | null)?.closest<HTMLElement>("[data-measure]")?.dataset.measure;
  return props.song.getMeasures().find(measure => measure.id === id);
}

onLongPress(list, (event) => {
  const measure = findMeasureAt(event.target);
  if (!props.editMode || event.pointerType === "mouse" || !measure) {
    return;
  }

  if (!isMeasureSelected(selection.value, measure.id)) {
    editorSelection.clickMeasure(measure.id, "toggle");
  }

  touchMultiSelect.value = true;
  suppressNextClick = true;
});

watch(playingId, (id) => {
  list.value?.querySelector(`[data-measure="${id}"]`)?.scrollIntoView({ block: "nearest" });
});
</script>

<template>
  <section
    class="size-full overflow-y-auto p-4 lg:px-14"
    :style="{ paddingBottom: `calc(${coveredBottom ?? 0}px + 1rem)` }"
    :aria-labelledby="titleId"
    @pointerdown.capture="rememberPointerType"
  >
    <h2
      :id="titleId"
      class="mb-1 text-lg font-semibold"
    >
      Measures
    </h2>
    <p class="mb-3 text-sm text-muted-color">
      This song has no score, so its measures are listed here in written order.
    </p>
    <ul
      ref="list"
      class="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2"
      :aria-labelledby="titleId"
    >
      <li
        v-for="measure in song.getMeasures()"
        :key="measure.id"
      >
        <button
          type="button"
          class="relative w-full rounded-md border py-3 text-sm font-semibold transition-colors"
          :class="isSelected(measure)
            ? 'border-primary bg-primary/30 outline-2 outline-primary'
            : 'border-surface-200 bg-surface-0 hover:bg-primary/10 dark:border-surface-700 dark:bg-surface-900'"
          :data-measure="measure.id"
          :aria-label="`Measure ${measure.label}`"
          :aria-pressed="editMode ? isSelected(measure) : undefined"
          :aria-current="measure.id === playingId ? 'location' : undefined"
          @click="onClick($event, measure)"
        >
          {{ measure.label }}
          <span
            v-if="measure.id === playingId"
            class="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-primary"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </section>
</template>
