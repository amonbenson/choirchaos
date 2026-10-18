<script setup lang="ts">
import Button from "primevue/button";
import { computed } from "vue";

import type Song from "@/core/models/song";
import { getSongSetup } from "@/core/models/songSetup";

const props = defineProps<{
  song: Song;
  compact?: boolean;
}>();

const emit = defineEmits<{
  continue: [];
}>();

const setup = computed(() => getSongSetup(props.song));
const summary = computed(() => setup.value.steps.map(step => `${step.label}: ${step.done ? "done" : "open"}`).join(", "));
</script>

<template>
  <div
    v-if="compact"
    class="truncate text-sm"
    :class="setup.next ? 'text-orange-600 dark:text-orange-400' : 'text-muted-color'"
  >
    <template v-if="setup.next">
      <i
        class="pi pi-exclamation-circle mr-1 text-xs"
        aria-hidden="true"
      />{{ setup.next.action }}
    </template>
    <template v-else>
      <i
        class="pi pi-check mr-1 text-xs text-primary"
        aria-hidden="true"
      />Ready
    </template>
  </div>

  <div
    v-else
    class="flex items-center gap-3"
  >
    <div
      class="flex w-23 gap-1"
      role="img"
      :aria-label="summary"
      :title="summary"
    >
      <span
        v-for="step in setup.steps"
        :key="step.id"
        class="h-1.5 w-5 rounded-full"
        :class="step.done ? 'bg-primary' : 'bg-surface-300 dark:bg-surface-600'"
      />
    </div>
    <Button
      v-if="setup.next"
      :label="setup.next.action"
      icon="pi pi-arrow-right"
      icon-pos="right"
      severity="warn"
      size="small"
      class="-my-1 px-1 py-0.5 whitespace-nowrap"
      text
      @click.stop="emit('continue')"
    />
    <span
      v-else
      class="text-sm whitespace-nowrap text-primary"
    ><i
      class="pi pi-check mr-1 text-xs"
      aria-hidden="true"
    />Ready</span>
  </div>
</template>
