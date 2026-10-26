<script setup lang="ts">
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import InputText from "primevue/inputtext";
import Slider from "primevue/slider";
import Toolbar from "primevue/toolbar";
import { computed, type ComputedRef } from "vue";

import PopoverButton from "@/components/base/PopoverButton.vue";
import DottedHalfNoteIcon from "@/components/icons/DottedHalfNoteIcon.vue";
import DottedQuarterNoteIcon from "@/components/icons/DottedQuarterNoteIcon.vue";
import HalfNoteIcon from "@/components/icons/HalfNoteIcon.vue";
import QuarterNoteIcon from "@/components/icons/QuarterNoteIcon.vue";
import { SECTION_COLORS } from "@/components/score/sectionColors";
import { formatLocation } from "@/core/models/locationFormat";
import { findRecordedPasses } from "@/core/models/recording";
import { formatPlayingSection, formatSectionPass } from "@/core/models/scoreOverlays";
import type Show from "@/core/models/show";
import { getBeatTick } from "@/core/player/timeline";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import PlaybackControlsForm from "./PlaybackControlsForm.vue";
import ShowBreadcrumb from "./ShowBreadcrumb.vue";
import TempoStepper from "./TempoStepper.vue";
import TranspositionStepper from "./TranspositionStepper.vue";
import UserMenuButton from "./UserMenuButton.vue";

type NoteValue = "quarter" | "half" | "dottedQuarter" | "dottedHalf";

const NOTE_VALUE_QUARTER_MAP: Record<NoteValue, number> = {
  quarter: 1,
  half: 2,
  dottedQuarter: 1.5,
  dottedHalf: 3,
};
const NOTE_VALUE_SVG_MAP: Record<NoteValue, object> = {
  quarter: QuarterNoteIcon,
  half: HalfNoteIcon,
  dottedQuarter: DottedQuarterNoteIcon,
  dottedHalf: DottedHalfNoteIcon,
};

// The breadcrumb shares the row with the Edit toggle. Below sm, and from lg up where the transport
// shares the row too, it only fits when they drop their labels.
const NARROW_HIDDEN_LABEL = "hidden sm:inline lg:hidden xl:inline";

const BAR_GAP = "gap-2 sm:gap-4 2xl:gap-8";

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
  "selectSong",
]);

const songs = computed(() => props.show?.songs ?? []);
const songIndex = computed(() => songs.value.findIndex(s => s.id === props.songId));

const player = usePlayerStore();
const settingsStore = useSettingsStore();

const visibleButtons = computed(() => settingsStore.current.appearance.transportButtonVisible);

const currentSong = computed(() => songs.value.find(song => song.id === props.songId));

const measureLabel = computed(() => {
  const location = player.ready ? player.currentLocation : undefined;
  return location ? currentSong.value?.findMeasure(location.measure)?.label : undefined;
});

const beatLabel = computed(() => player.ready && player.mode === "midi" && player.currentLocation
  ? String(player.currentLocation.beat + 1)
  : undefined);

const section = computed(() => player.ready ? player.currentSection : undefined);
const vamping = computed(() => section.value?.kind === "vamp" && !section.value.released);

const sectionLabel = computed(() => {
  const current = section.value;
  if (!current || current.kind === "cut") {
    return "Vamp";
  }

  return current.kind === "vamp" && current.released ? "Exiting" : formatSectionPass(current.kind, current);
});

/** Where each section's recorded passes lie on the playbar, as fractions of the song. */
const sectionRanges = computed(() => {
  const song = currentSong.value;
  const { timeline, duration } = player;
  if (!player.ready || !song || duration <= 0) {
    return [];
  }

  return song.getSections().flatMap((section, index) => {
    const passes = findRecordedPasses(timeline, section);
    const first = passes[0] && timeline[passes[0].first];
    const last = passes.at(-1) && timeline[passes.at(-1)!.last];
    if (!first || !last) {
      return [];
    }

    const start = getBeatTick(first, section.from.beat);
    const end = getBeatTick(last, section.to.beat + 1);
    return [{ key: index, kind: section.kind, left: start / duration, width: (end - start) / duration }];
  });
});

/** The measure and section the playbar is at, e.g. "19, 2nd time, Vamp pass 2". */
const positionText = computed(() => {
  const location = player.ready ? player.currentLocation : undefined;
  const song = currentSong.value;
  if (!location || !song) {
    return undefined;
  }

  const current = section.value;
  const measure = formatLocation(song, location);
  return current && current.kind !== "cut" ? `${measure}, ${formatPlayingSection(current.kind, current)}` : measure;
});

const tempoNoteValue: ComputedRef<NoteValue> = computed(() => {
  if (player.currentTimeSignature[0] % 3 === 0) {
    return player.currentTempo / 1.5 < 170 ? "dottedQuarter" : "dottedHalf";
  } else {
    return player.currentTempo < 170 ? "quarter" : "half";
  }
});
const writtenTempo = computed(() => player.currentTempo / NOTE_VALUE_QUARTER_MAP[tempoNoteValue.value]);

const speedPercentage = computed(() => Math.round(player.playbackSpeed * 100));
const isTempoChanged = computed(() => speedPercentage.value !== 100);

const tempoLabel = computed(() => {
  if (player.mode === "midi") {
    return player.ready ? `Tempo ${Math.round(player.playbackSpeed * writtenTempo.value)}` : "Tempo";
  }

  return isTempoChanged.value ? `Tempo ${speedPercentage.value} %` : "Tempo";
});

const transpositionText = computed(() => `${player.playbackTransposition > 0 ? "+" : ""}${player.playbackTransposition}`);

const timeSignatureText = computed(() => player.mode === "midi"
  ? `${player.currentTimeSignature[0]}/${Math.pow(2, player.currentTimeSignature[1])}`
  : "-/-");

const timeSignatureLabel = computed(() => player.mode === "midi"
  ? `Time signature ${timeSignatureText.value}`
  : "Time signature");

const hasMoreControls = computed(() => visibleButtons.value.transposition || visibleButtons.value.tempo
  || visibleButtons.value.timeSignature || visibleButtons.value.segue
  || (visibleButtons.value.measure && player.mode === "midi"));

// The bar only hides the beat on phones, so a "More" that would hold nothing else is only needed there.
const moreOnlyHoldsBeat = computed(() => !visibleButtons.value.transposition && !visibleButtons.value.tempo
  && !visibleButtons.value.timeSignature && !visibleButtons.value.segue);
</script>

<template>
  <div class="relative">
    <Toolbar
      class="relative px-2 sm:px-4"
      :class="playback ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]' : 'flex-nowrap'"
      :pt:start="`col-span-2 lg:col-span-1 flex justify-stretch lg:justify-start items-center min-w-0 overflow-hidden ${BAR_GAP}`"
      pt:center="flex justify-center items-center"
      :pt:end="playback ? 'contents' : 'flex-none'"
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
        <!-- Below lg the account sits next to the breadcrumb, so the playback controls have the second row to themselves. -->
        <div
          v-if="playback"
          class="col-span-2 col-start-2 row-start-2 flex min-w-0 items-center justify-end lg:col-span-1 lg:col-start-3 lg:row-start-1"
          :class="BAR_GAP"
        >
          <!-- Measure -->
          <div
            v-if="visibleButtons.measure"
            class="flex flex-none items-center justify-end gap-1"
          >
            <PopoverButton
              button-class="w-12 whitespace-nowrap"
              :aria-label="measureLabel === undefined ? 'Current measure' : `Current measure ${measureLabel}`"
              :label="measureLabel ?? '-'"
              :disabled="!player.ready"
            >
              <template #default="{ setFocusTarget }">
                <InputText
                  :ref="setFocusTarget"
                  :model-value="measureLabel"
                  aria-label="Current measure"
                  class="w-16"
                  fluid
                  @change="player.setMeasure(($event.target as HTMLInputElement).value)"
                />
              </template>
            </PopoverButton>
            <div class="hidden items-center gap-1 sm:flex">
              .
              <PopoverButton
                button-class="w-8 whitespace-nowrap"
                :aria-label="beatLabel === undefined ? 'Current beat' : `Current beat ${beatLabel}`"
                :label="beatLabel ?? '-'"
                :disabled="!player.ready || player.mode !== 'midi'"
              >
                <template #default="{ setFocusTarget }">
                  <InputNumber
                    :ref="setFocusTarget"
                    :model-value="(player.currentLocation?.beat ?? 0) + 1"
                    aria-label="Current beat"
                    class="w-16"
                    fluid
                    @update:model-value="player.setBeat($event - 1)"
                  />
                </template>
              </PopoverButton>
            </div>
          </div>

          <div class="hidden xl:contents">
            <!-- Transposition -->
            <PopoverButton
              v-if="visibleButtons.transposition"
              button-class="w-16 whitespace-nowrap"
              :aria-label="`Transposition ${transpositionText} semitones`"
              :label="`${transpositionText}&nbsp;HT`"
              :active="player.playbackTransposition !== 0"
            >
              <template #default="{ setFocusTarget }">
                <TranspositionStepper :ref="setFocusTarget" />
              </template>
            </PopoverButton>

            <!-- Tempo -->
            <PopoverButton
              v-if="visibleButtons.tempo"
              button-class="w-22 whitespace-nowrap"
              :aria-label="tempoLabel"
              :active="isTempoChanged"
            >
              <template #button>
                <template v-if="player.mode === 'midi'">
                  <component
                    :is="NOTE_VALUE_SVG_MAP[tempoNoteValue]"
                    class="mx-[-15%] inline size-6 fill-current"
                  />=&nbsp;{{ player.ready ? Math.round(player.playbackSpeed * writtenTempo) : "-" }}
                </template>
                <template v-else>
                  {{ isTempoChanged ? `${speedPercentage} %` : 'Tempo' }}
                </template>
              </template>

              <template #default="{ setFocusTarget }">
                <TempoStepper :ref="setFocusTarget" />
              </template>
            </PopoverButton>

            <!-- Time Signature -->
            <Button
              v-if="visibleButtons.timeSignature"
              class="cursor-default"
              severity="secondary"
              :label="timeSignatureText"
              :aria-label="timeSignatureLabel"
            />
          </div>

          <!-- Section: releases or resets a vamp, and shows the pass of a repeat -->
          <Button
            v-if="visibleButtons.vamp"
            class="min-w-0 shrink whitespace-nowrap sm:w-28 sm:flex-none"
            pt:label="truncate"
            :disabled="section?.kind !== 'vamp'"
            :label="sectionLabel"
            :severity="vamping ? 'primary': 'secondary'"
            @click="emit('toggleVamp')"
          />

          <!-- Segue -->
          <Button
            v-if="visibleButtons.segue"
            class="hidden w-24 whitespace-nowrap xl:inline-flex"
            :disabled="player.currentSegue === undefined"
            label="Segue"
            :aria-pressed="!!player.currentSegue?.enabled"
            :severity="player.currentSegue?.enabled ? 'primary': 'secondary'"
            @click="emit('toggleSegue')"
          />

          <!-- The controls that do not fit the bar below xl -->
          <div
            v-if="hasMoreControls"
            class="contents"
            :class="moreOnlyHoldsBeat ? 'sm:hidden' : 'xl:hidden'"
          >
            <PopoverButton
              button-class="flex-none"
              aria-label="More playback controls"
              :active="isTempoChanged || player.playbackTransposition !== 0 || !!player.currentSegue?.enabled"
            >
              <template #button>
                <i
                  class="pi pi-ellipsis-v"
                  aria-hidden="true"
                />
              </template>

              <PlaybackControlsForm
                :time-signature-text="timeSignatureText"
                @toggle-segue="emit('toggleSegue')"
              />
            </PopoverButton>
          </div>
        </div>

        <!-- User menu -->
        <UserMenuButton :class="playback ? 'col-start-3 row-start-1 justify-self-end lg:col-start-4' : '-ml-1'" />
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
        aria-label="Position"
        class="group w-full bg-transparent"
        pt:handle:class="scale-50 group-hover:scale-100 active:scale-100 transition-transform z-1"
        :pt:handle:aria-valuetext="positionText"
        pt:range:class="h-1"
        @update:model-value="player.seek($event as number)"
      />
      <!-- Drawn over the played range, so the sections stay visible, and under the handle -->
      <div
        class="pointer-events-none absolute inset-0"
        aria-hidden="true"
      >
        <div
          v-for="range of sectionRanges"
          :key="range.key"
          class="absolute inset-y-0"
          :class="SECTION_COLORS[range.kind].background"
          :style="{ left: `${range.left * 100}%`, width: `${range.width * 100}%` }"
        />
      </div>
    </div>
  </div>
</template>
