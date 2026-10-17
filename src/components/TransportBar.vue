<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Slider from "primevue/slider";
import Toolbar from "primevue/toolbar";
import { computed, type ComputedRef } from "vue";

import type Show from "@/core/models/show";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import PopoverButton from "./PopoverButton.vue";
import ShowBreadcrumb from "./ShowBreadcrumb.vue";
import DottedHalfNoteSvg from "./svg/DottedHalfNoteSvg.vue";
import DottedQuarterNoteSvg from "./svg/DottedQuarterNoteSvg.vue";
import HalfNoteSvg from "./svg/HalfNoteSvg.vue";
import QuarterNoteSvg from "./svg/QuarterNoteSvg.vue";
import UserMenuButton from "./UserMenuButton.vue";

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

// The breadcrumb shares the row with these buttons. Below sm, and from lg up where the transport
// shares the row too, it only fits when they drop their labels.
const NARROW_HIDDEN_LABEL = "hidden sm:inline lg:hidden xl:inline";

const props = defineProps<{
  show?: Show;
  songId?: string;
  playback?: boolean;
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
  "openSongDetails",
  "selectSong",
]);

const songs = computed(() => props.show?.songs ?? []);
const songIndex = computed(() => songs.value.findIndex(s => s.id === props.songId));

const player = usePlayerStore();
const settingsStore = useSettingsStore();

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
      class="relative px-4"
      :class="playback ? 'grid grid-cols-[auto_auto] lg:grid-cols-[repeat(3,auto)] lg:overflow-x-auto' : 'flex-nowrap'"
      pt:start="col-span-2 lg:col-span-1 flex justify-stretch lg:justify-start items-center gap-4 sm:gap-8 min-w-0 overflow-hidden"
      pt:center="flex justify-center items-center -space-x-2 sm:space-x-0"
      pt:end="overflow-x-auto lg:overflow-x-visible min-w-0"
    >
      <template #start>
        <ShowBreadcrumb
          :show="show"
          :song-id="songId"
          @select-song="emit('selectSong', $event)"
        />
        <Button
          v-if="canEdit && songId"
          label="Edit"
          icon="pi pi-pencil"
          :severity="editMode ? 'primary' : 'secondary'"
          :aria-pressed="editMode"
          aria-label="Edit"
          class="flex-none"
          :pt:label="NARROW_HIDDEN_LABEL"
          @click="emit('toggleEditMode')"
        />
        <Button
          v-if="canEdit && editMode"
          label="Details..."
          icon="pi pi-file-edit"
          severity="secondary"
          aria-label="Details..."
          class="flex-none"
          :pt:label="NARROW_HIDDEN_LABEL"
          @click="emit('openSongDetails')"
        />
        <slot name="actions" />
      </template>

      <template
        v-if="playback"
        #center
      >
        <Button
          :disabled="songIndex === 0 && player.position <= 0"
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
          :disabled="songIndex >= songs.length - 1"
          icon="pi pi-step-forward"
          severity="secondary"
          aria-label="Next Song"
          rounded
          text
          @click="emit('forward')"
        />
      </template>

      <template #end>
        <div class="flex items-center justify-end gap-4 sm:gap-8">
          <template v-if="playback">
            <!-- Measure -->
            <div
              v-if="visibleButtons.measure"
              class="flex items-center justify-end gap-1"
            >
              <PopoverButton
                button-class="w-12 whitespace-nowrap"
                :label="player.ready ? player.currentMeasure[0] : '-'"
                :disabled="!player.ready"
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
                :label="player.ready && player.mode === 'midi' ? String(player.currentMeasure[1] + 1) : '-'"
                :disabled="!player.ready || player.mode !== 'midi'"
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
                <template v-if="player.mode === 'midi'">
                  <component
                    :is="NOTE_VALUE_SVG_MAP[tempoNoteValue]"
                    class="mx-[-15%] inline size-6 fill-current"
                  />=&nbsp;{{ player.ready ? Math.round(player.playbackSpeed * writtenTempo) : "-" }}
                </template>
                <template v-else>
                  {{ Math.round(playbackSpeedPercentage) === 100 ? 'Tempo' : `${Math.round(playbackSpeedPercentage)} %` }}
                </template>
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
              <template v-if="player.mode === 'midi'">
                {{ player.currentTimeSignature[0] }}&nbsp;/&nbsp;{{ Math.pow(2, player.currentTimeSignature[1]) }}
              </template>
              <template v-else>
                &ndash;&nbsp;/&nbsp;&ndash;
              </template>
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
          </template>

          <!-- User menu -->
          <UserMenuButton class="-m-1 -ml-4" />
        </div>
      </template>
    </Toolbar>

    <span
      v-if="!playback"
      class="pointer-events-none absolute top-1/2 left-1/2 hidden -translate-1/2 text-xl font-bold md:block"
    >Choir Chaos</span>

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
      v-if="playback"
      class="absolute -bottom-0.5 left-2 h-1 w-[calc(100%-1rem)]"
    >
      <Slider
        :model-value="player.position"
        :min="0"
        :max="player.duration"
        class="group w-full bg-transparent"
        pt:handle:class="scale-50 group-hover:scale-100 active:scale-100 transition-transform z-1"
        pt:range:class="h-1"
        @update:model-value="player.seek($event as number)"
      />
    </div>
  </div>
</template>
