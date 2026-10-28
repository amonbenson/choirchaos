<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";

import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import { isSameReviewItem, planConfirm } from "@/core/models/measureReview";

const editor = injectMeasureEditor();
const { reviewItems, currentReviewItem, saving } = editor;
const { notifyError } = useNotify();

const position = computed(() => {
  const current = currentReviewItem.value;
  return current ? reviewItems.value.findIndex(item => isSameReviewItem(item, current)) + 1 : 0;
});

const label = computed(() => position.value > 0
  ? `${position.value} of ${reviewItems.value.length} to review`
  : `${reviewItems.value.length} to review`);

// Enter confirms while no control has the focus, so the review buttons let go of it once clicked.
function releaseFocus(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
}

function step(direction: 1 | -1): void {
  releaseFocus();
  editor.stepReview(direction);
}

async function confirmCurrent(): Promise<void> {
  const measure = currentReviewItem.value?.measure;
  if (!measure || saving.value) {
    return;
  }

  releaseFocus();
  try {
    await editor.resolveReview(planConfirm([measure]));
  } catch (error) {
    notifyError("Could not confirm the measure", error);
  }
}

defineExpose({ confirmCurrent });
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span
        class="flex items-center gap-2 text-sm font-semibold"
        aria-live="polite"
      >
        <span class="size-2 rounded-full bg-warn" />
        {{ label }}
      </span>
      <div
        v-if="currentReviewItem"
        class="flex"
      >
        <Button
          icon="pi pi-chevron-left"
          severity="secondary"
          size="small"
          text
          aria-label="Previous to review"
          @click="step(-1)"
        />
        <Button
          icon="pi pi-chevron-right"
          severity="secondary"
          size="small"
          text
          aria-label="Next to review"
          @click="step(1)"
        />
      </div>
      <Button
        v-else
        label="Review"
        severity="secondary"
        size="small"
        text
        @click="step(1)"
      />
    </div>

    <div
      v-if="currentReviewItem?.measure"
      class="flex items-center justify-between gap-2"
    >
      <span class="text-sm text-muted-color">The detector is unsure about this box.</span>
      <Button
        label="Confirm"
        icon="pi pi-check"
        severity="secondary"
        size="small"
        :disabled="saving"
        @click="confirmCurrent"
      />
    </div>
    <span
      v-if="currentReviewItem"
      class="text-xs text-muted-color pointer-coarse:hidden"
    >Enter confirms, typing corrects the number, Delete removes it.</span>
  </div>
</template>
