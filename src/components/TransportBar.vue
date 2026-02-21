<script setup lang="ts">
import Toolbar from "primevue/toolbar";
import Button from "primevue/button";
import Select from "primevue/select";
import Slider from "primevue/slider";
import { usePlayerStore } from "@/stores/player";
import Song from "@/core/show/song";
import QuarterNoteSvg from "./svg/QuarterNoteSvg.vue";
import { computed } from "vue";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import PopoverButton from "./PopoverButton.vue";

const props = defineProps<{
  songs?: Song[],
  loading?: boolean,
}>();

const emit = defineEmits<{
  rewind: [];
  forward: [];
  "play-pause": [];
  "vamp-out": [];
  "segue-toggle": [];
}>();

const songId = defineModel<string>();
const songIndex = computed(() => props.songs?.findIndex(s => s.id === songId.value) ?? 0);

const player = usePlayerStore();

const vampState = computed(() => player.ready && player.currentVamp ? (player.currentVamp.manualExit ? "exiting" : "vamping") : "none");

const playbackSpeedPercentage = computed({
  get: () => player.playbackSpeed * 100,
  set: (value) => player.playbackSpeed = value / 100,
});
</script>

<template>
  <div class="relative">
    <Toolbar
      class="relative px-4 grid grid-cols-[auto_auto] lg:grid-cols-[repeat(3,minmax(auto,1fr))] lg:overflow-x-auto"
      pt:start="col-span-2 lg:col-span-1 flex justify-stretch lg:justify-start items-center gap-8"
      pt:center="flex justify-center items-center -space-x-2 sm:space-x-0"
      pt:end="overflow-x-auto lg:overflow-x-visible"
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
          :icon="`pi ${player.position > 0 ? 'pi-backward' : 'pi-step-backward'}`"
          severity="secondary"
          aria-label="Rewind / Previous Song"
          rounded
          text
          @click="emit('rewind')"
        />
        <Button
          :disabled="!player.ready"
          :icon="`pi ${player.playing ? 'pi-pause' : 'pi-play'}`"
          aria-label="Play / Pause"
          rounded
          text
          @click="emit('play-pause')"
        />
        <Button
          class="flex-none"
          :disabled="songIndex >= (songs?.length ?? 0)"
          icon="pi pi-step-forward"
          severity="secondary"
          aria-label="Next Song"
          rounded
          text
          @click="emit('forward')"
        />
      </template>

      <template #end>
        <div class="flex justify-end items-center gap-4 sm:gap-8">
          <!-- Measure -->
          <div class="sm:w-24 max-w-24 flex justify-end items-center gap-1">
            <PopoverButton
              button-class="min-w-8"
              :label="player.ready ? player.currentMeasure[0] : '-'"
            >
              <template #default="{ setFocusTarget }">
                <InputText
                  :ref="setFocusTarget"
                  :model-value="player.currentMeasure[0]"
                  class="w-16"
                  fluid
                  @change="player.setMeasure(($event.target as HTMLInputElement).value)"
                />
              </template>
            </PopoverButton>
            .
            <PopoverButton
              button-class="min-w-8"
              :label="player.ready ? String(player.currentMeasure[1] + 1) : '-'"
            >
              <template #default="{ setFocusTarget }">
                <InputNumber
                  :ref="setFocusTarget"
                  :model-value="player.currentMeasure[1] + 1"
                  class="w-16"
                  fluid
                  @update:model-value="player.setBeat($event - 1)"
                />
              </template>
            </PopoverButton>
          </div>

          <!-- Transposition -->
          <PopoverButton
            :label="`${player.playbackTransposition > 0 ? '+' : ''}${player.playbackTransposition}&nbsp;HT`"
            :active="player.playbackTransposition !== 0"
          >
            <template #default="{ setFocusTarget }">
              <div class="flex justify-stretch items-center gap-1">
                <Button
                  icon="pi pi-minus"
                  severity="secondary"
                  size="small"
                  rounded
                  text
                  :disabled="player.playbackTransposition <= -11"
                  @click="player.playbackTransposition--"
                />
                <InputNumber
                  :ref="setFocusTarget"
                  v-model="player.playbackTransposition"
                  class="w-20"
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
                  :disabled="player.playbackTransposition >= 11"
                  @click="player.playbackTransposition++"
                />
              </div>
            </template>
          </PopoverButton>

          <!-- Tempo -->
          <PopoverButton :active="Math.round(playbackSpeedPercentage) !== 100">
            <template #button>
              <QuarterNoteSvg class="inline size-6 -mx-1.5 fill-current" />=&nbsp;{{ player.ready ? Math.round(player.playbackSpeed * player.currentTempo) : "-" }}
            </template>
            <template #default="{ setFocusTarget }">
              <div class="flex justify-stretch items-center gap-4">
                <Button
                  icon="pi pi-minus"
                  severity="secondary"
                  size="small"
                  rounded
                  text
                  :disabled="playbackSpeedPercentage <= 10"
                  @click="playbackSpeedPercentage--"
                />
                <InputNumber
                  :ref="setFocusTarget"
                  v-model="playbackSpeedPercentage"
                  class="w-18"
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
                  @click="playbackSpeedPercentage++"
                />
              </div>
            </template>
          </PopoverButton>

          <!-- Signature -->
          <!-- <Button
            class="cursor-default"
            severity="secondary"
          >
            {{ player.currentTimeSignature[0] }}&nbsp;/&nbsp;{{ Math.pow(2, player.currentTimeSignature[1]) }}
          </Button> -->

          <!-- Vamp -->
          <Button
            class="min-w-24"
            pt:label:class="whitespace-nowrap"
            :disabled="vampState === 'none'"
            :label="{
              'none': 'Vamp',
              'vamping': player.currentVamp?.iterations
                ? `Vamp ${player.currentVamp?.currentIteration + 1}/${player.currentVamp?.iterations}`
                : `Vamp ${player.currentVamp?.currentIteration + 1}`,
              'exiting': 'Exiting...'
            }[vampState]"
            :severity="vampState === 'vamping' ? 'primary': 'secondary'"
            @click="emit('vamp-out')"
          />

          <!-- Segue -->
          <Button
            class="w-24"
            :disabled="player.currentSegue === undefined"
            label="Segue"
            :severity="player.currentSegue?.enabled ? 'primary': 'secondary'"
            @click="emit('segue-toggle')"
          />
        </div>
      </template>
    </Toolbar>

    <!-- Progress Bar -->
    <!-- <div
      class="absolute left-2 -bottom-0.5 h-1 bg-primary rounded-full shadow-[0_0_0.75rem] shadow-primary/10"
      :class="{
        'hidden': !player.ready,
        'transition-all': !player.playing,
      }"
      :style="{
        width: `calc(${player.position / player.duration * 100}% - 1rem)`
      }"
    /> -->
    <div
      class="absolute left-2 -bottom-0.5 h-1 w-[calc(100%-1rem)]"
    >
      <Slider
        :model-value="player.position"
        :min="0"
        :max="player.duration"
        class="w-full group bg-transparent"
        pt:handle:class="scale-50 group-hover:scale-100 active:scale-100 transition-transform z-1"
        pt:range:class="h-1"
        @update:model-value="player.seek($event as number)"
      />
    </div>
  </div>
</template>
