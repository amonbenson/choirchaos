<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import BabySvenja from "@/components/BabySvenja.vue";
import KbdShortcut from "@/components/KbdShortcut.vue";
import MarkerPanel from "@/components/MarkerPanel.vue";
import MeasurePanel from "@/components/MeasurePanel.vue";
import MixerPanel from "@/components/MixerPanel.vue";
import SongDetailsDialog from "@/components/SongDetailsDialog.vue";
import SongPdfViewer from "@/components/SongPdfViewer.vue";
import TransportBar from "@/components/TransportBar.vue";
import VampCard from "@/components/VampCard.vue";
import WarpPanel from "@/components/WarpPanel.vue";
import { type ShortcutAction, useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import { provideMeasureEditor, useMeasureEditor } from "@/composables/useMeasureEditor";
import Show from "@/core/models/show";
import type Song from "@/core/models/song";
import { getAccessFlags } from "@/pocketbase/auth";
import { consumePendingShow } from "@/router/router";
import { useAuthStore } from "@/stores/auth";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

const auth = useAuthStore();
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
const editMode = computed(() => route.name === "song-edit");
const canEdit = computed(() => !!show.value && getAccessFlags(show.value.permissions, auth.user?.id).editor);
const showWarpPanel = computed(() => editMode.value && song.value?.playerMode === "audio");
const songDetailsVisible = ref(false);

provideMeasureEditor(useMeasureEditor(song, editMode));

// The song editor has no markers tab. Below lg its Measures panel is a bottom sheet over the score.
const tabs = computed(() => editMode.value
  ? { pdf: "PDF", mixer: "Mixer" }
  : { markers: "Markers", pdf: "PDF", mixer: "Mixer" });
const selectedTab = computed(() => editMode.value && settings.current.workspace.selectedTab === "markers"
  ? "pdf"
  : settings.current.workspace.selectedTab);

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

useGlobalShortcuts(settings.current.shortcuts.bindings as unknown as Record<string, ShortcutAction>, {
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
  if (player.ready && player.position > 0) {
    player.seek(0);
  } else {
    const prev = songs.value[songIndex.value - 1];
    if (prev) {
      selectSong(prev.id);
    }
  }
}

function forward(): void {
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

// Leave pages the user lost access to, e.g. after signing out
watch(() => auth.user, (user) => {
  if (!show.value) {
    return;
  }

  const access = getAccessFlags(show.value.permissions, user?.id);
  if (!access.viewer) {
    router.replace({ name: "home" });
  } else if (!access.editor && editMode.value) {
    router.replace({ name: "song", params: route.params });
  }
});

// NAVIGATION

// Player and editor share one history entry, so the browser back button leaves both.
function toggleEditMode(): void {
  router.replace({ name: editMode.value ? "song" : "song-edit", params: route.params });
}

// SONG MANAGEMENT

async function onSongSaved(saved: Song, { playbackChanged }: { playbackChanged: boolean }): Promise<void> {
  show.value?.sortSongs();
  if (playbackChanged && saved === song.value) {
    await player.load(saved);
  }
}

function onSongDeleted(deleted: Song): void {
  if (deleted !== song.value) {
    return;
  }

  const next = songs.value[songIndex.value] ?? songs.value[songIndex.value - 1];
  if (next) {
    selectSong(next.id);
  } else {
    router.replace({ name: "show-edit", params: { showId: props.showId } });
  }
}

// SETTINGS

onMounted(() => {
  // Apply initial playback modifiers from settings store
  player.playbackSpeed = settings.current.playback.speed;
  player.playbackTransposition = settings.current.playback.transposition;
  player.setSegueEnabled(settings.current.playback.segueEnabled);
  player.setVampsEnabled(settings.current.playback.vampsEnabled);
});

watch(() => player.playbackSpeed, value => settings.update({ playback: { speed: value } }));
watch(() => player.playbackTransposition, value => settings.update({ playback: { transposition: value } }));

// Apply the global segue setting whenever the current song changes or the setting is toggled.
watch(() => [song.value, settings.current.playback.segueEnabled], () => {
  if (player.currentSegue !== undefined) {
    player.setSegueEnabled(settings.current.playback.segueEnabled);
  }
});

watch(() => settings.current.playback.vampsEnabled, value => player.setVampsEnabled(value));

// DATA LOADING PROCEDURE

function selectSong(songId?: string, autoplay: boolean = false): void {
  // route to the correct song
  if (songId && songId !== props.songId) {
    router.replace({
      name: editMode.value ? "song-edit" : "song",
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

    // Load show if not already done so
    if (!show.value) {
      const pending = consumePendingShow();
      show.value = pending ?? await Show.get(props.showId);
    }

    showLoading.value = false;

    // If no song id was selected, clear the current song
    if (songId === undefined) {
      song.value = undefined;
      return;
    }

    // Select the song
    song.value = show.value.songs.find(s => s.id === songId);
    if (!song.value) {
      console.error("Invalid song id:", songId);
      const firstSong = show.value.songs[0];
      if (firstSong) {
        selectSong(firstSong.id);
      }

      return;
    }

    // Load the selected song
    await player.load(song.value);
    player.setSegueEnabled(settings.current.playback.segueEnabled);

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

// PDF Loader
const pdfLoading = ref(false);
</script>

<template>
  <div
    class="grid size-full grid-cols-1 gap-2 overflow-hidden p-2 lg:grid-cols-[auto_1fr_auto]"
    :class="showWarpPanel
      ? 'grid-rows-[auto_auto_1fr_auto] lg:grid-rows-[auto_1fr_auto]'
      : 'grid-rows-[auto_auto_1fr] lg:grid-rows-[auto_1fr]'"
  >
    <TransportBar
      class="lg:col-span-3"
      :show="show"
      :song-id="songId"
      :edit-mode="editMode"
      :can-edit="canEdit"
      playback
      @select-song="selectSong($event)"
      @play-pause="playPause"
      @rewind="rewind"
      @forward="forward"
      @toggle-vamp="toggleVamp"
      @toggle-segue="toggleSegue"
      @toggle-edit-mode="toggleEditMode"
      @open-song-details="songDetailsVisible = true"
    />
    <ButtonGroup class="w-full lg:hidden">
      <Button
        v-for="name, tab in tabs"
        :key="tab"
        :label="name"
        :severity="selectedTab === tab ? 'primary' : 'secondary'"
        fluid
        @click="settings.update({ workspace: { selectedTab: tab } })"
      />
    </ButtonGroup>
    <!--
      desktop: use lg:contents to make the wrapper div invisible and use its contents as direct grid children
      mobile: div acts as a single grid cell where all panels overlap absolutely
    -->
    <div class="relative size-full lg:contents">
      <!-- Markers Panel (player) or Measures Panel (editor) -->
      <div
        class="absolute inset-0 transition-all lg:relative lg:inset-auto lg:size-full"
        :class="[
          editMode
            ? ['pointer-events-none z-10 lg:pointer-events-auto', selectedTab !== 'pdf' ? 'invisible lg:visible' : '']
            : selectedTab !== 'markers' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : '',
          settings.current.workspace.panelVisible.markers ? 'lg:w-96' : 'lg:w-0',
        ]"
      >
        <MeasurePanel
          v-if="editMode"
          class="pointer-events-auto absolute inset-x-0 bottom-0 max-h-[60%] min-h-0 lg:inset-0 lg:max-h-none"
          :class="settings.current.workspace.panelVisible.markers ? 'lg:opacity-100' : 'lg:opacity-0'"
          :song="song"
        />
        <MarkerPanel
          v-else
          class="absolute inset-0 min-h-0"
          :class="[
            settings.current.workspace.panelVisible.markers ? 'lg:opacity-100' : 'lg:opacity-0',
          ]"
          :song="song"
        />
        <Button
          class="absolute top-2 left-full z-10 hidden transition-all lg:block"
          :class="settings.current.workspace.panelVisible.markers ? 'rounded-l-none' : ''"
          :aria-label="editMode ? 'Show Measures Panel' : 'Show Markers Panel'"
          :icon="`pi ${settings.current.workspace.panelVisible.markers ? 'pi-chevron-left' : 'pi-chevron-right'}`"
          severity="secondary"
          rounded
          @click="settings.togglePanelVisible('markers')"
        />
      </div>

      <!-- PDF Panel -->
      <div
        class="absolute inset-0 lg:relative lg:inset-auto lg:size-full"
        :class="selectedTab !== 'pdf' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : ''"
      >
        <div class="absolute inset-0">
          <SongPdfViewer
            class="size-full"
            :song="song"
            :edit-mode="editMode"
            @pdf-loading="pdfLoading = $event"
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
        <div
          v-if="show && !showLoading && songs.length === 0"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center"
        >
          <i class="pi pi-book text-5xl text-muted-color" />
          <span class="text-xl font-semibold">No songs yet</span>
          <span class="text-muted-color">Songs appear here as soon as they are added to "{{ show.title }}".</span>
        </div>
        <div
          v-if="player.loading || pdfLoading"
          class="absolute top-0 left-0 flex size-full flex-col items-center justify-center bg-black/50 text-white select-none"
        >
          <BabySvenja class="w-full max-w-lg" />
          <p class="text-xl">
            Loading {{ player.loading ? "audio data" : "PDF" }} ...
          </p>
        </div>
      </div>

      <!-- Mixer Panel -->
      <div
        class="absolute inset-0 transition-all lg:relative lg:inset-auto lg:size-full"
        :class="[
          selectedTab !== 'mixer' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : '',
          settings.current.workspace.panelVisible.mixer ? 'lg:w-96' : 'lg:w-0',
        ]"
      >
        <MixerPanel
          class="absolute inset-0 min-h-0"
          :class="[
            settings.current.workspace.panelVisible.mixer ? 'lg:opacity-100' : 'lg:opacity-0',
          ]"
          :song="song"
          :edit-mode="editMode"
          @open-song-details="songDetailsVisible = true"
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

    <!-- Warp Panel (audio mode) -->
    <WarpPanel
      v-if="showWarpPanel"
      class="lg:col-span-3"
      :song="song"
    />

    <SongDetailsDialog
      v-if="show && song"
      v-model="songDetailsVisible"
      :show="show"
      :song="song"
      @saved="onSongSaved"
      @deleted="onSongDeleted"
    />
  </div>
</template>
