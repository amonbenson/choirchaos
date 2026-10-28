<script setup lang="ts">
import Slider from "primevue/slider";
import { computed } from "vue";

import { usePlayerStore } from "@/stores/player";

// The handle moves in thousandths of the song, finer than any screen shows, so the slider re-renders a few times a second.
const STEPS = 1000;

defineProps<{
  valueText?: string;
}>();

const player = usePlayerStore();

const value = computed(() => player.duration > 0 ? Math.round(player.position / player.duration * STEPS) / STEPS * player.duration : 0);
</script>

<template>
  <Slider
    :model-value="value"
    :min="0"
    :max="player.duration"
    aria-label="Position"
    class="group w-full bg-transparent"
    pt:handle:class="scale-50 group-hover:scale-100 active:scale-100 transition-transform z-1"
    :pt:handle:aria-valuetext="valueText"
    pt:range:class="h-1"
    @update:model-value="player.seek($event as number)"
  />
</template>
