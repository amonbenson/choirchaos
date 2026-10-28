<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints, useResizeObserver, useScroll } from "@vueuse/core";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Toolbar from "primevue/toolbar";
import { computed, type ComputedRef, useTemplateRef } from "vue";

import PopoverButton from "@/components/base/PopoverButton.vue";
import DottedHalfNoteIcon from "@/components/icons/DottedHalfNoteIcon.vue";
import DottedQuarterNoteIcon from "@/components/icons/DottedQuarterNoteIcon.vue";
import HalfNoteIcon from "@/components/icons/HalfNoteIcon.vue";
import QuarterNoteIcon from "@/components/icons/QuarterNoteIcon.vue";
import { SECTION_COLORS, SECTION_CONTRAST_TEXT } from "@/components/score/sectionColors";
import { formatLocation } from "@/core/models/locationFormat";
import { findRecordedRepeats, formatPlayingSection, formatSectionPass, getRecordedRepeatPass } from "@/core/models/scoreOverlays";
import type Show from "@/core/models/show";
import { getSectionTicks } from "@/core/player/route";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

import LocationButtons from "./LocationButtons.vue";
import PositionSlider from "./PositionSlider.vue";
import ShowBreadcrumb from "./ShowBreadcrumb.vue";
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

const isEditLabelled = useBreakpoints(breakpointsTailwind).greaterOrEqual("sm");

const controls = useTemplateRef("controls");
const controlsContent = useTemplateRef("controlsContent");
const { arrivedState, measure: measureControlsScroll } = useScroll(controls);
useResizeObserver([controls, controlsContent], () => measureControlsScroll());

/** Fades the edges of the playback controls where more of them are scrolled out of view. */
const controlsMask = computed(() => [
  arrivedState.left ? "" : "mask-l-from-[calc(100%-2rem)]",
  arrivedState.right ? "" : "mask-r-from-[calc(100%-2rem)]",
]);

const currentSong = computed(() => songs.value.find(song => song.id === props.songId));

const section = computed(() => player.ready ? player.currentSection : undefined);

const atStart = computed(() => player.position <= 0);

const recordedRepeats = computed(() => currentSong.value ? findRecordedRepeats(currentSong.value.getTimeline()) : []);

/** The section button shows the playing section, else a written repeat. Playback skips cuts, so it only plays one after a seek into it. */
const shownSection = computed(() => {
  if (section.value) {
    return section.value;
  }

  const playing = player.ready ? player.currentTimelinePosition : undefined;
  const pass = playing ? getRecordedRepeatPass(recordedRepeats.value, playing.position) : undefined;
  return pass ? { kind: "repeat" as const, ...pass, released: false } : undefined;
});

const sectionLabel = computed(() => {
  const current = shownSection.value;
  if (!current) {
    return "Vamp";
  }

  if (current.kind === "cut") {
    return "Cut";
  }

  return current.kind === "vamp" && current.released ? "Exiting" : formatSectionPass(current.kind, current);
});

/** A released vamp drops its color, so the button shows it will exit. */
const sectionButtonClass = computed(() => {
  const current = shownSection.value;
  return current && !current.released ? [SECTION_COLORS[current.kind].background, SECTION_CONTRAST_TEXT, "border-transparent"] : [];
});

function toggleVamp(): void {
  if (section.value?.kind === "vamp") {
    emit("toggleVamp");
  }
}

/** Where each section's recorded passes lie on the playbar, as fractions of the song. */
const sectionRanges = computed(() => {
  const song = currentSong.value;
  const { timeline, duration } = player;
  if (!player.ready || !song || duration <= 0) {
    return [];
  }

  const sections = song.getSections();
  return sections.flatMap((section, index) => {
    const ticks = getSectionTicks(timeline, sections, section);
    return ticks ? [{ key: index, kind: section.kind, left: ticks.start / duration, width: (ticks.end - ticks.start) / duration }] : [];
  });
});

/** The measure and section the playbar is at, e.g. "19, 2nd time, Vamp pass 2". */
const positionText = computed(() => {
  const playing = player.ready ? player.currentTimelinePosition : undefined;
  const song = currentSong.value;
  if (!playing || !song) {
    return undefined;
  }

  const current = section.value;
  const measure = formatLocation(song, playing);
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
const playedTempo = computed(() => player.ready ? String(Math.round(player.playbackSpeed * writtenTempo.value)) : "-");

const playbackSpeedPercentage = computed({
  get: () => Math.round(player.playbackSpeed * 100),
  set: value => player.playbackSpeed = value / 100,
});

const tempoLabel = computed(() => player.ready ? `Tempo ${playedTempo.value}` : "Tempo");

const transpositionText = computed(() => `${player.playbackTransposition > 0 ? "+" : ""}${player.playbackTransposition}`);

const timeSignatureText = computed(() => player.mode === "midi"
  ? `${player.currentTimeSignature[0]}/${Math.pow(2, player.currentTimeSignature[1])}`
  : "-/-");

const timeSignatureLabel = computed(() => player.mode === "midi"
  ? `Time signature ${timeSignatureText.value}`
  : "Time signature");
</script>

<template>
  <div class="relative">
    <Toolbar
      class="relative px-2 sm:px-4"
      :class="playback ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,auto)_auto_minmax(0,auto)_auto]' : 'flex-nowrap'"
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
          :label="isEditLabelled ? 'Edit' : undefined"
          icon="pi pi-pencil"
          :severity="editMode ? 'primary' : 'secondary'"
          :aria-pressed="editMode"
          aria-label="Edit"
          class="flex-none"
          :rounded="!isEditLabelled"
          :text="!isEditLabelled && !editMode"
          @click="emit('toggleEditMode')"
        />
        <slot name="actions" />
      </template>

      <template
        v-if="playback"
        #center
      >
        <Button
          :disabled="songIndex === 0 && atStart"
          :icon="`pi ${atStart ? 'pi-step-backward' : 'pi-backward'}`"
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
          ref="controls"
          class="col-span-2 col-start-2 row-start-2 min-w-0 overflow-x-auto lg:col-span-1 lg:col-start-3 lg:row-start-1"
          :class="controlsMask"
        >
          <div
            ref="controlsContent"
            class="ml-auto flex w-max items-center"
            :class="BAR_GAP"
          >
            <LocationButtons
              v-if="visibleButtons.measure"
              :song="currentSong"
            />

            <!-- Transposition -->
            <PopoverButton
              v-if="visibleButtons.transposition"
              button-class="w-16 whitespace-nowrap"
              :aria-label="`Transposition ${transpositionText} semitones`"
              :label="`${transpositionText}&nbsp;HT`"
              :active="player.playbackTransposition !== 0"
            >
              <template #default="{ setFocusTarget }">
                <InputNumber
                  :ref="setFocusTarget"
                  v-model="player.playbackTransposition"
                  aria-label="Transposition in semitones"
                  class="w-36"
                  :min="-12"
                  :max="12"
                  :prefix="player.playbackTransposition > 0 ? '+' : ''"
                  suffix=" HT"
                  show-buttons
                  button-layout="horizontal"
                  increment-button-icon="pi pi-plus"
                  decrement-button-icon="pi pi-minus"
                  fluid
                />
              </template>
            </PopoverButton>

            <!-- Tempo -->
            <PopoverButton
              v-if="visibleButtons.tempo"
              button-class="w-22 whitespace-nowrap"
              :aria-label="tempoLabel"
              :active="playbackSpeedPercentage !== 100"
            >
              <template #button>
                <component
                  :is="NOTE_VALUE_SVG_MAP[tempoNoteValue]"
                  class="mx-[-15%] inline size-6 fill-current"
                />=&nbsp;{{ playedTempo }}
              </template>

              <template #default="{ setFocusTarget }">
                <InputNumber
                  :ref="setFocusTarget"
                  v-model="playbackSpeedPercentage"
                  aria-label="Playback speed in percent"
                  class="w-36"
                  :min="10"
                  :max="300"
                  suffix=" %"
                  show-buttons
                  button-layout="horizontal"
                  increment-button-icon="pi pi-plus"
                  decrement-button-icon="pi pi-minus"
                  fluid
                />
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

            <!-- Section: releases or resets a vamp, and shows the pass of a repeat section or a written repeat -->
            <Button
              v-if="visibleButtons.vamp"
              class="w-28 whitespace-nowrap"
              :class="sectionButtonClass"
              :disabled="!shownSection"
              :label="sectionLabel"
              severity="secondary"
              @click="toggleVamp"
            />

            <!-- Segue -->
            <Button
              v-if="visibleButtons.segue"
              class="w-24 whitespace-nowrap"
              :disabled="player.currentSegue === undefined"
              label="Segue"
              :aria-pressed="!!player.currentSegue?.enabled"
              :severity="player.currentSegue?.enabled ? 'primary': 'secondary'"
              @click="emit('toggleSegue')"
            />
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
      <PositionSlider :value-text="positionText" />
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
