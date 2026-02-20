<script setup lang="ts">
import Button from "primevue/button";
import Popover from "primevue/popover";
import { ref } from "vue";

defineProps<{
  label?: string;
  active?: boolean;
  disabled?: boolean;
  "buttonClass"?: string;
}>();

const popover = ref();
const focusTarget = ref<any>(null);

function onShow() {
  // Check if a target element was provided
  const el = focusTarget.value;
  if (!el) {
    return;
  }

  // Get the input element
  const input = el.$el
    ? el.$el.querySelector("input") ?? el.$el
    : el.querySelector?.("input") ?? el;

  // Focus and select all text
  input?.focus?.();
  input?.select?.();
}
</script>

<template>
  <Button
    :class="buttonClass"
    :severity="active ? 'primary' : 'secondary'"
    :label="label"
    :disabled="disabled"
    @click="popover.toggle($event)"
  >
    <slot name="button" />
  </Button>
  <Popover
    ref="popover"
    @show="onShow"
  >
    <slot :set-focus-target="(el: any) => focusTarget = el" />
  </Popover>
</template>
