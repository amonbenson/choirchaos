<script setup lang="ts">
import Toolbar from "primevue/toolbar";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { usePlayerStore } from "@/stores/player";
import Song from "@/core/show/song";

defineProps<{
  songs?: Song[],
  loading?: boolean,
}>();

const songId = defineModel<string>();

const player = usePlayerStore();
</script>

<template>
  <div class="relative">
    <Toolbar class="relative">
      <template #start>
        <Select
          v-model="songId"
          class="w-64 border-none"
          :options="songs"
          option-value="id"
          :option-label="song => `#${song.number} ${song.title}`"
          :loading="loading"
          size="small"
          placeholder="Auswahl"
        />
      </template>

      <template #center>
        <Button
          :disabled="!player.ready"
          :icon="`pi ${player.playing ? 'pi-pause' : 'pi-play'}`"
          aria-label="Play"
          rounded
          text
          @click="player.playing ? player.pause() : player.play()"
        />
        <Button
          :disabled="!player.ready"
          icon="pi pi-stop"
          severity="secondary"
          aria-label="Stop"
          rounded
          text
          @click="player.stop()"
        />
        <Button
          :disabled="!player.ready || !player.currentVamp"
          label="Exit Vamp"
          :severity="player.ready && player.currentVamp && !player.currentVamp.manualExit ? 'primary' : 'secondary'"
          @click="player.exitVamp()"
        />
      </template>

      <template #end>
        <div class="flex justify-between items-center gap-8">
          <!-- Measure display -->
          <div class="flex justify-stretch items-center gap-1">
            <InputText
              :model-value="player.currentMeasure[0]"
              :disabled="!player.ready"
              class="w-12 rounded-r-none text-center border-none"
              size="small"
              placeholder="1"
              aria-label="Measure"
              fluid
              @update:model-value="player.setMeasure($event ?? '')"
            />
            <InputNumber
              :model-value="player.currentMeasure[1] + 1"
              :disabled="!player.ready"
              class="w-12"
              pt:pcinputtext:root:class="rounded-l-none text-center border-none"
              size="small"
              placeholder="1"
              aria-label="Beat"
              fluid
              @update:model-value="player.setBeat($event)"
            />
            <div class="flex-none">
              /&nbsp;{{ player.finalMeasure[0] }}
            </div>
          </div>

          <!-- Tempo -->
          <div class="flex justify-stretch items-center">
            <div class="flex-none">
              T&nbsp;=&nbsp;
            </div>
            <InputNumber
              :model-value="player.currentTempo"
              :disabled="!player.ready"
              class="w-12"
              pt:pcinputtext:root:class="text-center border-none"
              size="small"
              placeholder="1"
              aria-label="Beat"
              fluid
            />
          </div>
        </div>
      </template>
    </Toolbar>

    <!-- Progress Bar -->
    <div
      class="absolute left-0 -bottom-0.5 h-1 bg-primary rounded-full shadow-[0_0_0.75rem] shadow-primary/10"
      :class="{
        'hidden': !player.ready,
        'transition-all': !player.playing,
      }"
      :style="{
        width: `${player.position / player.duration * 100}%`
      }"
    />
  </div>
</template>
