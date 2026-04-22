<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Select from "primevue/select";
import Slider from "primevue/slider";
import Toolbar from "primevue/toolbar";
import { computed, type ComputedRef, ref } from "vue";

import Song from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import PopoverButton from "./PopoverButton.vue";
import SettingsDialog from "./SettingsDialog.vue";
import DottedHalfNoteSvg from "./svg/DottedHalfNoteSvg.vue";
import DottedQuarterNoteSvg from "./svg/DottedQuarterNoteSvg.vue";
import HalfNoteSvg from "./svg/HalfNoteSvg.vue";
import QuarterNoteSvg from "./svg/QuarterNoteSvg.vue";

type NoteValue = "quarter" | "half" | "dottedQuarter" | "dottedHalf";

const NOTE_VALUE_QUARTER_MAP: Record<NoteValue, number> = {
  quarter: 1,
  half: 2,
  dottedQuarter: 1.5,
  dottedHalf: 3,
};
const NOTE_VALUE_SVG_MAP: Record<NoteValue, object> = {
  quarter: QuarterNoteSvg,
  half: HalfNoteSvg,
  dottedQuarter: DottedQuarterNoteSvg,
  dottedHalf: DottedHalfNoteSvg,
};

const props = defineProps<{
  songs?: Song[];
  loading?: boolean;
  editMode?: boolean;
  canEdit?: boolean;
}>();

const emit = defineEmits([
  "rewind",
  "forward",
  "playPause",
  "toggleVamp",
  "toggleSegue",
  "toggleEditMode",
]);

const songId = defineModel<string>();
const songIndex = computed(() => props.songs?.findIndex(s => s.id === songId.value) ?? 0);

const player = usePlayerStore();
const settingsStore = useSettingsStore();
const settingsVisible = ref(false);

const visibleButtons = computed(() => settingsStore.current.appearance.transportButtonVisible);

const vampState = computed(() => player.ready && player.currentVamp ? (player.currentVamp.manualExit ? "exiting" : "vamping") : "none");

const tempoNoteValue: ComputedRef<NoteValue> = computed(() => {
  if (player.currentTimeSignature[0] % 3 === 0) {
    return player.currentTempo / 1.5 < 170 ? "dottedQuarter" : "dottedHalf";
  } else {
    return player.currentTempo < 170 ? "quarter" : "half";
  }
});
const writtenTempo = computed(() => player.currentTempo / NOTE_VALUE_QUARTER_MAP[tempoNoteValue.value]);

const playbackSpeedPercentage = computed({
  get: () => player.playbackSpeed * 100,
  set: value => player.playbackSpeed = value / 100,
});
</script>

<template>
  <div class="relative">
    <Toolbar
      class="relative grid grid-cols-[auto_auto] px-4 lg:grid-cols-[repeat(3,auto)] lg:overflow-x-auto"
      pt:start="col-span-2 lg:col-span-1 flex justify-stretch lg:justify-start items-center gap-8 min-w-0 overflow-hidden"
      pt:center="flex justify-center items-center -space-x-2 sm:space-x-0"
      pt:end="overflow-x-auto lg:overflow-x-visible min-w-0"
    >
      <template #start>
        <Select
          v-model="songId"
          class="w-full min-w-0 border-none whitespace-nowrap lg:w-88"
          :options="songs"
          option-value="id"
          :option-label="song => `#${song.number} ${song.title}`"
          scroll-height="80vh"
        />
      </template>

      <template #center>
        <Button
          :disabled="!player.ready || (songIndex === 0 && player.position <= 0)"
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
          @click="emit('playPause')"
        />
        <Button
          class="flex-none"
          :disabled="!player.ready || songIndex >= (songs?.length ?? 1) - 1"
          icon="pi pi-step-forward"
          severity="secondary"
          aria-label="Next Song"
          rounded
          text
          @click="emit('forward')"
        />
        <Button
          v-if="canEdit"
          icon="pi pi-pencil"
          :severity="editMode ? 'primary' : 'secondary'"
          aria-label="Toggle Edit Mode"
          rounded
          text
          @click="emit('toggleEditMode')"
        />
      </template>

      <template #end>
        <div class="flex items-center justify-end gap-4 sm:gap-8">
          <!-- Measure -->
          <div
            v-if="visibleButtons.measure"
            class="flex items-center justify-end gap-1"
          >
            <PopoverButton
              button-class="w-12 whitespace-nowrap"
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
              button-class="w-8 whitespace-nowrap"
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
            v-if="visibleButtons.transposition"
            button-class="w-16 whitespace-nowrap"
            :label="`${player.playbackTransposition > 0 ? '+' : ''}${player.playbackTransposition}&nbsp;HT`"
            :active="player.playbackTransposition !== 0"
          >
            <template #default="{ setFocusTarget }">
              <div class="flex items-center justify-stretch gap-1">
                <Button
                  icon="pi pi-minus"
                  severity="secondary"
                  size="small"
                  rounded
                  text
                  :disabled="player.playbackTransposition <= -12"
                  @click="player.playbackTransposition--"
                />
                <InputNumber
                  :ref="setFocusTarget"
                  v-model="player.playbackTransposition"
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
                  @click="player.playbackTransposition++"
                />
              </div>
            </template>
          </PopoverButton>

          <!-- Tempo -->
          <PopoverButton
            v-if="visibleButtons.tempo"
            button-class="w-22 whitespace-nowrap"
            :active="Math.round(playbackSpeedPercentage) !== 100"
          >
            <template #button>
              <component
                :is="NOTE_VALUE_SVG_MAP[tempoNoteValue]"
                class="mx-[-15%] inline size-6 fill-current"
              />=&nbsp;{{ player.ready ? Math.round(player.playbackSpeed * writtenTempo) : "-" }}
            </template>
            <template #default="{ setFocusTarget }">
              <div class="flex items-center justify-stretch gap-4">
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

          <!-- Time Signature -->
          <Button
            v-if="visibleButtons.timeSignature"
            class="cursor-default"
            severity="secondary"
          >
            {{ player.currentTimeSignature[0] }}&nbsp;/&nbsp;{{ Math.pow(2, player.currentTimeSignature[1]) }}
          </Button>

          <!-- Vamp -->
          <Button
            v-if="visibleButtons.vamp"
            class="w-24 whitespace-nowrap"
            :disabled="vampState === 'none'"
            :label="{
              'none': 'Vamp',
              'vamping': player.currentVamp?.iterations
                ? `Vamp ${(player.currentVamp?.currentIteration ?? 0) + 1}/${player.currentVamp?.iterations}`
                : `Vamp ${(player.currentVamp?.currentIteration ?? 0) + 1}`,
              'exiting': 'Exiting...'
            }[vampState]"
            :severity="vampState === 'vamping' ? 'primary': 'secondary'"
            @click="emit('toggleVamp')"
          />

          <!-- Segue -->
          <Button
            v-if="visibleButtons.segue"
            class="w-24 whitespace-nowrap"
            :disabled="player.currentSegue === undefined"
            label="Segue"
            :severity="player.currentSegue?.enabled ? 'primary': 'secondary'"
            @click="emit('toggleSegue')"
          />

          <!-- Settings -->
          <Button
            class="-m-1 -ml-4"
            icon="pi pi-cog"
            severity="secondary"
            aria-label="Settings"
            rounded
            text
            @click="settingsVisible = true"
          />
        </div>
      </template>
    </Toolbar>

    <SettingsDialog v-model="settingsVisible" />

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
      class="absolute -bottom-0.5 left-2 h-1 w-[calc(100%-1rem)]"
    >
      <Slider
        :model-value="player.position"
        :min="0"
        :max="player.duration"
        :step="0.01"
        class="group w-full bg-transparent"
        pt:handle:class="scale-50 group-hover:scale-100 active:scale-100 transition-transform z-1"
        pt:range:class="h-1"
        @update:model-value="player.seek($event as number)"
      />
    </div>
  </div>
</template>
