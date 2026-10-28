<script setup lang="ts">
import { useTemplateRef } from "vue";

import MeasureUnnumberedForm from "@/components/editor/measures/MeasureUnnumberedForm.vue";
import { injectMeasureEditor } from "@/composables/useMeasureEditor";
import { useNotify } from "@/composables/useNotify";
import type { MeasureLayout } from "@/core/models/measure";
import { planRemoveBoxes } from "@/core/models/measureEditing";

import RemoveButton from "./RemoveButton.vue";

const props = defineProps<{
  boxes: MeasureLayout[];
}>();

const editor = injectMeasureEditor();
const { saving, unnumberedBoxes } = editor;
const { notifyError } = useNotify();
const single = useTemplateRef<InstanceType<typeof MeasureUnnumberedForm>>("single");

async function remove(): Promise<void> {
  if (single.value) {
    single.value.remove();
    return;
  }

  try {
    await editor.apply(planRemoveBoxes([], props.boxes, unnumberedBoxes.value));
  } catch (error) {
    notifyError("Could not remove the boxes", error);
  }
}

function place(): void {
  single.value?.place();
}

defineExpose({ remove, place });
</script>

<template>
  <!-- A form per box, so moving on to the next box drops the focus from the number field. -->
  <MeasureUnnumberedForm
    v-if="boxes.length === 1"
    :key="`${boxes[0]!.page}:${boxes[0]!.x}:${boxes[0]!.y}`"
    ref="single"
    :box="boxes[0]!"
  />
  <div
    v-else
    class="flex flex-col gap-3"
  >
    <span class="text-sm text-muted-color">The detector could not read the numbers of these boxes. Number them one at a time, or remove them.</span>
    <RemoveButton
      label="Remove boxes"
      :disabled="saving"
      @click="remove"
    />
  </div>
</template>
