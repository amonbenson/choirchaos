<script setup lang="ts">
import Toolbar from "primevue/toolbar";
import Button from "primevue/button";
import Select from "primevue/select";
import Popover from "primevue/popover";
import Slider from "primevue/slider";
import { usePlayerStore } from "@/stores/player";
import Song from "@/core/show/song";
import QuarterNoteSvg from "./svg/QuarterNoteSvg.vue";
import { computed, ref } from "vue";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";

const props = defineProps<{
  songs?: Song[],
  loading?: boolean,
}>();

const songId = defineModel<string>();

const player = usePlayerStore();

// popover ui elements
const measurePopover = ref();
const beatPopover = ref();
const transpositionPopover = ref();
const tempoPopover = ref();

const vampState = computed(() => player.ready && player.currentVamp ? (player.currentVamp.manualExit ? "exiting" : "vamping") : "none");
const song = computed(() => props.songs?.find(s => s.id === songId.value));

const playbackSpeedPercentage = computed({
  get: () => player.playbackSpeed * 100,
  set: (value) => player.playbackSpeed = value / 100,
});
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
            :label="player.ready ? player.currentMeasure[0] : '-'"
            @click="measurePopover.toggle($event)"
          />
          <Popover ref="measurePopover">
            <InputText
              :model-value="player.currentMeasure[0]"
              class="w-16"
              fluid
              @update:model-value="player.setMeasure($event ?? '')"
            />
          </Popover>
          .
          <Button
            class="min-w-8"
            severity="secondary"
            :label="player.ready ? String(player.currentMeasure[1]) : '-'"
            @click="beatPopover.toggle($event)"
          />
          <Popover ref="beatPopover">
            <InputNumber
              :model-value="player.currentMeasure[1] + 1"
              class="w-16"
              fluid
              @update:model-value="player.setBeat($event - 1)"
            />
          </Popover>
        </div>

        <!-- Transposition -->
        <Button
          :label="`${player.playbackTransposition > 0 ? '+' : ''}${player.playbackTransposition}&nbsp;HT`"
          :severity="player.playbackTransposition !== 0 ? 'primary' : 'secondary'"
          @click="transpositionPopover.toggle($event)"
        />
        <Popover
          ref="transpositionPopover"
          pt:content:class="flex justify-stretch items-center gap-1"
        >
          <Button
            icon="pi pi-minus"
            severity="secondary"
            size="small"
            rounded
            text
            @click="player.playbackTransposition--"
          />
          <InputNumber
            v-model="player.playbackTransposition"
            class="w-18"
            :min="-11"
            :max="11"
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
            @click="player.playbackTransposition++"
          />
        </Popover>

        <!-- Tempo -->
        <Button
          :severity="Math.round(playbackSpeedPercentage) !== 100 ? 'primary' : 'secondary'"
          @click="tempoPopover.toggle($event)"
        >
          <QuarterNoteSvg class="inline size-6 -mx-1.5 fill-current" />=&nbsp;{{ player.ready ? Math.round(player.playbackSpeed * player.currentTempo) : "-" }}
        </Button>
        <Popover
          ref="tempoPopover"
          pt:content:class="flex justify-stretch items-center gap-4"
        >
          <InputNumber
            v-model="playbackSpeedPercentage"
            class="w-18"
            :min="10"
            :max="300"
            :step="1"
            suffix=" %"
            fluid
          />
          <Slider
            v-model="playbackSpeedPercentage"
            :min="10"
            :max="300"
            :step="1"
            class="w-32"
            fluid
          />
        </Popover>

        <!-- Signature -->
        <Button
          class="cursor-default"
          severity="secondary"
        >
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
