<script setup lang="ts">
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import { computed } from "vue";

import PopoverButton from "@/components/base/PopoverButton.vue";
import type Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{
  song: Song | undefined;
}>();

const player = usePlayerStore();

const measureLabel = computed(() => {
  const playing = player.ready ? player.currentTimelinePosition : undefined;
  return playing ? props.song?.findMeasure(playing.measure)?.label : undefined;
});

const beat = computed(() => player.ready ? player.currentLocation?.beat : undefined);
const beatLabel = computed(() => beat.value === undefined ? undefined : String(beat.value + 1));
</script>

<template>
  <div class="flex items-center gap-1">
    <PopoverButton
      button-class="w-12 whitespace-nowrap"
      :aria-label="measureLabel === undefined ? 'Current measure' : `Current measure ${measureLabel}`"
      :label="measureLabel ?? '-'"
      :disabled="!player.ready"
    >
      <template #default="{ setFocusTarget }">
        <InputText
          :ref="setFocusTarget"
          :model-value="measureLabel"
          aria-label="Current measure"
          class="w-16"
          fluid
          @change="player.setMeasure(($event.target as HTMLInputElement).value)"
        />
      </template>
    </PopoverButton>
    .
    <PopoverButton
      button-class="w-8 whitespace-nowrap"
      :aria-label="beatLabel === undefined ? 'Current beat' : `Current beat ${beatLabel}`"
      :label="beatLabel ?? '-'"
      :disabled="!player.ready"
    >
      <template #default="{ setFocusTarget }">
        <InputNumber
          :ref="setFocusTarget"
          :model-value="(beat ?? 0) + 1"
          aria-label="Current beat"
          class="w-16"
          fluid
          @update:model-value="player.setBeat($event - 1)"
        />
      </template>
    </PopoverButton>
  </div>
</template>
