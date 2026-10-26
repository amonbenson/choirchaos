<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";

import { usePlayerStore } from "@/stores/player";

const player = usePlayerStore();
</script>

<template>
  <div class="flex items-center justify-stretch gap-1">
    <Button
      icon="pi pi-minus"
      severity="secondary"
      size="small"
      rounded
      text
      :disabled="player.playbackTransposition <= -12"
      aria-label="Transpose down"
      @click="player.playbackTransposition--"
    />
    <InputNumber
      v-model="player.playbackTransposition"
      aria-label="Transposition in semitones"
      class="w-20"
      :min="-12"
      :max="12"
      :step="1"
      :prefix="player.playbackTransposition > 0 ? '+' : ''"
      suffix=" HT"
      fluid
    />
    <Button
      icon="pi pi-plus"
      severity="secondary"
      size="small"
      rounded
      text
      :disabled="player.playbackTransposition >= 12"
      aria-label="Transpose up"
      @click="player.playbackTransposition++"
    />
  </div>
</template>
