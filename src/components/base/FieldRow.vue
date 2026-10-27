<script setup lang="ts">
import { useId } from "vue";

const props = defineProps<{
  label: string;
  /** The id of the control, for controls that other code focuses by id. */
  inputId?: string;
}>();

const id = props.inputId ?? useId();
const labelId = `${id}-label`;
</script>

<template>
  <div class="flex items-center justify-between gap-2">
    <label
      :id="labelId"
      :for="id"
      class="text-sm"
    >{{ label }}</label>
    <slot v-bind="{ id, labelId }" />
  </div>
</template>
