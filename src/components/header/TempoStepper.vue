<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import { computed } from "vue";

import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();

const playbackSpeedPercentage = computed({
  get: () => player.playbackSpeed * 100,
  set: value => player.playbackSpeed = value / 100,
});
</script>

<template>
  <div class="flex items-center justify-stretch gap-1">
    <Button
      icon="pi pi-minus"
      severity="secondary"
      size="small"
      rounded
      text
      :disabled="playbackSpeedPercentage <= 10"
      aria-label="Slower"
      @click="playbackSpeedPercentage--"
    />
    <InputNumber
      v-model="playbackSpeedPercentage"
      aria-label="Playback speed in percent"
      class="w-20"
      :min="10"
      :max="300"
      :step="1"
      suffix=" %"
      fluid
    />
    <Button
      icon="pi pi-plus"
      severity="secondary"
      size="small"
      rounded
      text
      :disabled="playbackSpeedPercentage >= 300"
      aria-label="Faster"
      @click="playbackSpeedPercentage++"
    />
  </div>
</template>
