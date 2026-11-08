<script setup lang="ts">
import { usePreferredReducedMotion } from "@vueuse/core";
import { computed, useTemplateRef, watch } from "vue";

import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

/** Sheared from the bottom, so the neck stays put while the head dips forward. */
const NOD_KEYFRAMES: Keyframe[] = [
  { transform: "none", easing: "ease-out" },
  { transform: "skewX(-10deg) scaleY(0.92)", easing: "ease-in-out", offset: 0.25 },
  { transform: "none" },
];

/** Slow tempos get a quick nod and a longer rest, so the head never looks sluggish. */
const MAX_NOD_MS = 450;

const player = usePlayerStore();
const settings = useSettingsStore();
const reducedMotion = usePreferredReducedMotion();
const logo = useTemplateRef("logo");

const isBobbing = computed(() => settings.current.appearance.logoHeadBob && reducedMotion.value !== "reduce"
  && player.playing && !player.buffering);

/** Changes once per pulse, so the watcher below runs per pulse instead of per beat. */
const pulseKey = computed(() => {
  const location = player.currentLocation;
  if (!isBobbing.value || !location) {
    return undefined;
  }

  const { beatsPerPulse } = player.currentPulse;
  return location.beat % beatsPerPulse === 0 ? `${location.position}:${location.beat}` : undefined;
});

watch(pulseKey, (key) => {
  if (!key) {
    return;
  }

  const pulseMs = 60000 / (player.currentPulse.bpm * player.playbackSpeed);
  logo.value?.animate?.(NOD_KEYFRAMES, { duration: Math.min(pulseMs * 0.9, MAX_NOD_MS) });
});
</script>

<template>
  <img
    ref="logo"
    src="/favicon.svg"
    alt=""
    class="size-8 origin-bottom rounded-full"
  >
</template>
