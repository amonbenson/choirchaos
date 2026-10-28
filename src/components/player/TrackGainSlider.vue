<script setup lang="ts">
import Slider from "primevue/slider";
import { computed, ref } from "vue";

import type Track from "@/core/models/track";
import { usePlayerStore } from "@/stores/player";

const props = defineProps<{
  /** The tracks the slider controls together. Their notes flash it in MIDI mode, their level shows in audio mode. */
  tracks: Track[];
  gain: number;
  name: string;
}>();

const emit = defineEmits<{
  "update:gain": [gain: number];
}>();

const player = usePlayerStore();

const isAudioMode = computed(() => player.mode === "audio");

const flashing = ref(false);

player.onNote((event) => {
  const track = props.tracks.find(t => t.mixer.index === event.trackIndex);
  if (flashing.value || !track || track.mixer.effectiveGain < 0.01) {
    return;
  }

  flashing.value = true;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flashing.value = false;
    });
  });
});

const amplitude = computed(() => Math.max(0, ...props.tracks.map(track => player.trackAmplitudes[track.mixer.index] ?? 0)));
</script>

<template>
  <div class="relative mx-2 flex-1">
    <Slider
      :model-value="gain"
      class="w-full"
      :min="0"
      :max="1"
      :step="0.001"
      :aria-label="`Volume of ${name}`"
      :pt:range:class="flashing ? 'bg-primary transition-none' : 'bg-(--p-slider-track-background) transition-colors duration-500'"
      pt:handle="!z-[2]"
      @update:model-value="emit('update:gain', $event as number)"
    />
    <div
      v-if="isAudioMode"
      class="pointer-events-none absolute inset-0 z-1 flex items-center"
      aria-hidden="true"
    >
      <div
        class="h-0.75 rounded-full bg-primary/70 transition-none"
        :style="{ width: `${amplitude * 100}%` }"
      />
    </div>
  </div>
</template>
