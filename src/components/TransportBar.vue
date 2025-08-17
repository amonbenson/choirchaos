<script setup lang="ts">
import Toolbar from "primevue/toolbar";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { computed } from "vue";
import { usePlayerStore } from "@/stores/player";
import { isNumbering } from "@/core/utils/numbering";
import Song from "@/core/show/song";

const props = defineProps<{
  songs: Song[] | null,
  loading?: boolean,
}>();

const songId = defineModel<string>();

const player = usePlayerStore();

const song = computed(() => props.songs?.find(s => s.id === songId.value));

function setMeasure(value: string) {
  // validate input
  if (!isNumbering(value)) {
    value = "1";
  }

  // find the measure and seek to its starting beat position
  const measure = song.value.findMeasure(value);
  player.position = measure.$beatTicks[0];
}

function setBeat(value: number) {
  // convert to zero-indexd number
  value -= 1;

  // find the measure, validate input range, and seek
  const measure = song.value.findMeasure(player.currentMeasure[0]);
  if (value < 0) {
    value = 0;
  } else if (value >= measure.beats) {
    value = measure.beats - 1;
  }
  player.position = measure.$beatTicks[value];
}
</script>

<template>
  <div class="relative">
    <Toolbar class="relative">
      <template #start>
        <Select
          v-model="songId"
          :options="songs"
          option-value="id"
          :option-label="song => `#${song.number} ${song.title}`"
          :loading="loading"
          class="w-64"
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
      </template>

      <template #end>
        <div class="w-64 flex justify-stretch items-center">
          <InputText
            :model-value="player.currentMeasure[0]"
            :disabled="!player.ready"
            class="basis-1/3 rounded-r-none text-center"
            size="small"
            placeholder="1"
            aria-label="Measure"
            fluid
            @update:model-value="setMeasure($event)"
          />
          <InputNumber
            :model-value="player.currentMeasure[1] + 1"
            :disabled="!player.ready"
            class="basis-1/3"
            pt:pcinputtext:root:class="rounded-l-none text-center"
            size="small"
            placeholder="1"
            aria-label="Beat"
            fluid
            @update:model-value="setBeat($event)"
          />
          <div>&ensp;/&ensp;</div>
          <InputText
            :model-value="player.finalMeasure[0]"
            :disabled="!player.ready"
            class="basis-1/3 text-center"
            size="small"
            placeholder="1"
            aria-label="Measure"
            fluid
          />
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
