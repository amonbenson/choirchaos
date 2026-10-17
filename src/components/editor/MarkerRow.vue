<script setup lang="ts">
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { ref, watch } from "vue";

import type { MarkerEvent } from "@/core/models/measureEvent";
import type Song from "@/core/models/song";

const props = defineProps<{
  song: Song;
  marker: MarkerEvent;
  active: boolean;
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  update: [measure: string, name: string];
  remove: [];
}>();

const measure = ref("");
const name = ref("");
const measureInvalid = ref(false);
const row = ref<HTMLElement>();

function reset(): void {
  measure.value = props.marker.start[0];
  name.value = props.marker.marker;
  measureInvalid.value = false;
}

watch(() => [props.marker.start[0], props.marker.marker], reset, { immediate: true });

function commit(): void {
  const trimmedMeasure = measure.value.trim();
  const trimmedName = name.value.trim();
  measureInvalid.value = !props.song.findMeasure(trimmedMeasure);
  if (measureInvalid.value) {
    return;
  }

  if (!trimmedName) {
    name.value = props.marker.marker;
    return;
  }

  if (trimmedMeasure !== props.marker.start[0] || trimmedName !== props.marker.marker) {
    emit("update", trimmedMeasure, trimmedName);
  }
}

// The row of a new marker renders before its save finishes, which is when it learns to take the focus.
watch(() => props.autofocus, (autofocus) => {
  if (!autofocus) {
    return;
  }

  const input = row.value?.querySelector<HTMLInputElement>("[data-marker-name]");
  input?.focus();
  input?.select();
}, { immediate: true, flush: "post" });
</script>

<template>
  <div
    ref="row"
    class="flex items-center gap-2 border-l-2 pl-2 transition-colors"
    :class="active ? 'border-primary' : 'border-transparent'"
  >
    <InputText
      v-model="measure"
      class="w-16 flex-none font-mono"
      size="small"
      :invalid="measureInvalid"
      :aria-label="`Measure of marker ${marker.marker}`"
      :title="measureInvalid ? 'This song has no such measure.' : undefined"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.esc="reset"
    />
    <InputText
      v-model="name"
      data-marker-name
      class="min-w-0 flex-1"
      size="small"
      :aria-label="`Name of marker ${marker.marker}`"
      @blur="commit"
      @keydown.enter="commit"
      @keydown.esc="reset"
    />
    <Button
      icon="pi pi-trash"
      severity="secondary"
      size="small"
      :aria-label="`Delete marker ${marker.marker}`"
      text
      rounded
      @click="emit('remove')"
    />
  </div>
</template>
