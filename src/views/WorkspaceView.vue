<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import KbdShortcut from "@/components/KbdShortcut.vue";
import MarkerPanel from "@/components/MarkerPanel.vue";
import MixerPanel from "@/components/MixerPanel.vue";
import SongPdfViewer from "@/components/SongPdfViewer.vue";
import TransportBar from "@/components/TransportBar.vue";
import VampCard from "@/components/VampCard.vue";
import { useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import Show from "@/core/models/show";
import type Song from "@/core/models/song";
import { getAccessFlags, NoAccess, type Permissions } from "@/pocketbase/auth";
import { consumePendingShow } from "@/router/router";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

const settings = useSettingsStore();
const player = usePlayerStore();
const route = useRoute();
const router = useRouter();

const props = defineProps<{
  showId: string;
  songId?: string;
}>();

// store show and current song data from pocketbase
const show = ref<Show | undefined>();
const showLoading = ref(true);

const song = ref<Song | undefined>();
const songLoading = ref(true);
const editMode = ref(false);

const songs = computed(() => show.value?.songs ?? []);
const songIndex = computed(() => songs.value.findIndex(s => s.id === props.songId));

const vampCardType = computed(() => {
  if (player.playing) {
    if (player.currentVamp && !player.currentVamp.manualExit) {
      return "vamp";
    } else if (player.currentSegue?.enabled && player.currentMeasure[0] === player.finalMeasure[0]) {
      return "segue";
    }
  }

  // default action
  return "pause";
});

useGlobalShortcuts(settings.current.shortcuts, {
  playPause: () => vampCardType.value === "vamp" ? toggleVamp() : playPause(),
  previousMeasure,
  nextMeasure,
  rewind,
  forward,
  toggleVamp,
  toggleSegue,
});

function playPause(): void {
  if (player.playing) {
    player.pause();

    // Reset Vamp on pause
    player.resetVamp();
  } else {
    player.play();
  }
}

function previousMeasure(): void {
  if (!player.ready || !song.value) {
    return;
  }

  const measures = song.value.measures.items();
  const i = song.value.findMeasureIndex(player.currentMeasure[0]);
  const prev = measures[i - 1];
  if (prev) {
    player.seek(prev.$beatTicks[0] ?? 0);
  }
}

function nextMeasure(): void {
  if (!player.ready || !song.value) {
    return;
  }

  const measures = song.value.measures.items();
  const i = song.value.findMeasureIndex(player.currentMeasure[0]);
  const next = measures[i + 1];
  if (next) {
    player.seek(next.$beatTicks[0] ?? 0);
  }
}

function rewind(): void {
  if (!player.ready) {
    return;
  }

  if (player.position > 0) {
    player.seek(0);
  } else {
    const prev = songs.value[songIndex.value - 1];
    if (prev) {
      selectSong(prev.id);
    }
  }
}

function forward(): void {
  if (!player.ready) {
    return;
  }

  const next = songs.value[songIndex.value + 1];
  if (next) {
    selectSong(next.id);
  }
}

function toggleVamp(): void {
  player.toggleVamp();
}

function toggleSegue(): void {
  player.toggleSegue();
}

player.onSegue(() => {
  // Select the next song
  const nextSong = show.value?.songs[songIndex.value + 1];
  if (!nextSong) {
    return;
  }

  selectSong(nextSong.id, true);
});

// SETTINGS

onMounted(() => {
  // Apply initial playback modifiers from settings store
  player.playbackSpeed = settings.current.playback.speed;
  player.playbackTransposition = settings.current.playback.transposition;
  player.setSegueEnabled(settings.current.playback.segueEnabled);
});

watch(() => player.playbackSpeed, value => settings.updatePlayback({ speed: value }));
watch(() => player.playbackTransposition, value => settings.updatePlayback({ transposition: value }));

// Apply the global segue setting whenever the current song changes or the setting is toggled.
watch(() => [song.value, settings.current.playback.segueEnabled], () => {
  if (player.currentSegue !== undefined) {
    player.setSegueEnabled(settings.current.playback.segueEnabled);
  }
});

// DATA LOADING PROCEDURE

function selectSong(songId?: string, autoplay: boolean = false): void {
  // route to the correct song
  if (songId && songId !== props.songId) {
    router.replace({
      name: "song",
      params: {
        showId: props.showId,
        songId,
      },
      query: {
        ...(autoplay ? { autoplay: "1" } : {}),
      },
    });
  }
}

// Reload whenever song id changes (and initially)
watch(() => props.songId, async (songId) => {
  try {
    showLoading.value = true;
    songLoading.value = true;

    // If no song id was selected, clear the current song
    if (songId === undefined) {
      song.value = undefined;
      return;
    }

    // Load show if not already done so
    if (!show.value) {
      const pending = consumePendingShow();
      show.value = pending ?? await Show.get(props.showId);
    }

    showLoading.value = false;

    // Select the song
    song.value = show.value.songs.find(s => s.id === songId);
    if (!song.value) {
      console.error(`Internal error: ShowView was created with an invalid song id: ${songId}`);
      return;
    }

    // Load the selected song
    await player.load(song.value);

    // Start playing immediately if autoplay was enabled
    if (route.query.autoplay) {
      // Consume the flag
      const { autoplay: _, ...query } = route.query;
      router.replace({ ...route, query });

      player.play();
    }
  } catch (err) {
    console.error(err);
  } finally {
    showLoading.value = false;
    songLoading.value = false;
  }
}, { immediate: true });
</script>

<template>
  <div class="grid size-full grid-cols-1 grid-rows-[auto_auto_1fr] gap-2 overflow-hidden p-2 lg:grid-cols-[auto_1fr_auto] lg:grid-rows-[auto_1fr]">
    <TransportBar
      class="lg:col-span-3"
      :model-value="songId"
      :songs="show?.songs"
      :loading="showLoading || songLoading"
      @update:model-value="selectSong($event)"
      @play-pause="playPause"
      @rewind="rewind"
      @forward="forward"
      @toggle-vamp="toggleVamp"
      @toggle-segue="toggleSegue"
    />
    <ButtonGroup class="w-full lg:hidden">
      <Button
        v-for="name, tab in {
          markers: 'Markers',
          pdf: 'PDF',
          mixer: 'Mixer',
        }"
        :key="tab"
        :label="name"
        :severity="settings.current.workspace.selectedTab === tab ? 'primary' : 'secondary'"
        fluid
        @click="settings.updateWorkspace({ selectedTab: tab })"
      />
    </ButtonGroup>
    <!--
      desktop: use lg:contents to make the wrapper div invisible and use its contents as direct grid children
      mobile: div acts as a single grid cell where all panels overlap absolutely
    -->
    <div class="relative size-full lg:contents">
      <!-- Markers Panel -->
      <div
        class="absolute inset-0 transition-all lg:relative lg:inset-auto lg:size-full"
        :class="[
          settings.current.workspace.selectedTab !== 'markers' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : '',
          settings.current.workspace.panelVisible.markers ? 'lg:w-96' : 'lg:w-0',
        ]"
      >
        <MarkerPanel
          class="absolute inset-0 min-h-0"
          :class="[
            settings.current.workspace.panelVisible.markers ? 'lg:opacity-100' : 'lg:opacity-0',
          ]"
          :song="song"
          :edit-mode="editMode"
        />
        <Button
          class="absolute top-2 left-full z-10 hidden transition-all lg:block"
          :class="settings.current.workspace.panelVisible.markers ? 'rounded-l-none' : ''"
          aria-label="Show Markers Panel"
          :icon="`pi ${settings.current.workspace.panelVisible.markers ? 'pi-chevron-left' : 'pi-chevron-right'}`"
          severity="secondary"
          rounded
          @click="settings.togglePanelVisible('markers')"
        />
      </div>

      <!-- PDF Panel -->
      <div
        class="absolute inset-0 lg:relative lg:inset-auto lg:size-full"
        :class="settings.current.workspace.selectedTab !== 'pdf' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : ''"
      >
        <div class="absolute inset-0">
          <SongPdfViewer
            class="size-full"
            :song="song"
            @update:edit-mode="editMode = $event"
          />
        </div>
        <div class="absolute bottom-4 left-1/2 w-[calc(100%-2rem)] -translate-x-1/2 md:w-72 lg:bottom-16">
          <VampCard
            v-if="vampCardType === 'vamp'"
            class="size-full cursor-pointer"
            :title="`Vamping (x${(player.currentVamp?.currentIteration ?? 0) + 1})`"
            @click="toggleVamp()"
          >
            <span class="touch:hidden">Press <KbdShortcut action="playPause" /> to exit</span>
            <span class="hidden touch:inline">Click here to exit</span>
          </VampCard>
          <VampCard
            v-else-if="vampCardType === 'segue'"
            class="size-full"
            title="Segueing"
          >
            Loading the next song
          </VampCard>
        </div>
      </div>

      <!-- Mixer Panel -->
      <div
        class="absolute inset-0 transition-all lg:relative lg:inset-auto lg:size-full"
        :class="[
          settings.current.workspace.selectedTab !== 'mixer' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : '',
          settings.current.workspace.panelVisible.mixer ? 'lg:w-96' : 'lg:w-0',
        ]"
      >
        <MixerPanel
          class="absolute inset-0 min-h-0"
          :class="[
            settings.current.workspace.panelVisible.mixer ? 'lg:opacity-100' : 'lg:opacity-0',
          ]"
          :song="song"
        />
        <Button
          class="absolute top-2 right-full z-10 hidden transition-all lg:block"
          :class="settings.current.workspace.panelVisible.mixer ? 'rounded-r-none' : ''"
          aria-label="Show Markers Panel"
          :icon="`pi ${settings.current.workspace.panelVisible.mixer ? 'pi-chevron-right' : 'pi-chevron-left'}`"
          severity="secondary"
          rounded
          @click="settings.togglePanelVisible('mixer')"
        />
      </div>
    </div>
  </div>
</template>
