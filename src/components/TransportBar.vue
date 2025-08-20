<script setup lang="ts">
import Toolbar from "primevue/toolbar";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import InputNumber from "primevue/inputnumber";
import Select from "primevue/select";
import { usePlayerStore } from "@/stores/player";
import Song from "@/core/show/song";
import QuarterNoteSvg from "./svg/QuarterNoteSvg.vue";
import { computed } from "vue";

const props = defineProps<{
  songs?: Song[],
  loading?: boolean,
}>();

const songId = defineModel<string>();

const player = usePlayerStore();

const vampState = computed(() => player.ready && player.currentVamp ? (player.currentVamp.manualExit ? "exiting" : "vamping") : "none");
const song = computed(() => props.songs?.find(s => s.id === songId.value));
</script>

<template>
  <div class="relative">
    <Toolbar
      class="relative px-4 grid grid-cols-[auto_1fr] lg:grid-cols-[repeat(3,minmax(auto,1fr))]"
      pt:start="col-span-2 lg:col-span-1 flex justify-stretch lg:justify-start items-center gap-8"
      pt:center="flex justify-center items-center gap-0"
      pt:end="flex justify-end items-center gap-2 sm:gap-8"
    >
      <template #start>
        <Select
          v-model="songId"
          class="w-full lg:w-88 border-none"
          :options="songs"
          option-value="id"
          :option-label="song => `#${song.number} ${song.title}`"
          :loading="loading"
          scroll-height="80vh"
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
        <!-- Measure -->
        <div class="w-26 max-w-26 flex justify-end items-center gap-1">
          <Button
            class="min-w-8"
            severity="secondary"
          >
            {{ player.ready ? player.currentMeasure[0] : "-" }}
          </Button>
          .
          <Button
            class="min-w-8"
            severity="secondary"
          >
            {{ player.ready ? player.currentMeasure[1] + 1 : "-" }}
          </Button>
        </div>

        <!-- Tempo -->
        <Button severity="secondary">
          <QuarterNoteSvg class="inline size-6 -mx-1.5 fill-current" />=&nbsp;{{ player.ready ? player.currentTempo : "-" }}
        </Button>

        <!-- Signature -->
        <Button severity="secondary">
          {{ player.currentTimeSignature[0] }}&nbsp;/&nbsp;{{ Math.pow(2, player.currentTimeSignature[1]) }}
        </Button>

        <!-- Vamp -->
        <Button
          class="min-w-24 hidden sm:block"
          :disabled="vampState === 'none'"
          :label="{
            'none': 'Vamp',
            'vamping': player.currentVamp?.iterations
              ? `Vamp ${player.currentVamp?.currentIteration + 1}/${player.currentVamp?.iterations}`
              : `Vamp ${player.currentVamp?.currentIteration + 1}`,
            'exiting': 'Exiting...'
          }[vampState]"
          :severity="vampState === 'vamping' ? 'primary': 'secondary'"
          @click="player.exitVamp()"
        />

        <!-- Segue -->
        <Button
          class="w-24 hidden md:block"
          :disabled="!song?.events.segue"
          label="Segue"
          :severity="song?.events.segue ? 'primary': 'secondary'"
          @click="player.exitVamp()"
        />
      </template>
    </Toolbar>

    <!-- Progress Bar -->
    <div
      class="absolute left-2 -bottom-0.5 h-1 bg-primary rounded-full shadow-[0_0_0.75rem] shadow-primary/10"
      :class="{
        'hidden': !player.ready,
        'transition-all': !player.playing,
      }"
      :style="{
        width: `calc(${player.position / player.duration * 100}% - 1rem)`
      }"
    />
  </div>
</template>
