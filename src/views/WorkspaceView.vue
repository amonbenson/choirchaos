<script setup lang="ts">
import { breakpointsTailwind, useBreakpoints, useElementSize } from "@vueuse/core";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import Message from "primevue/message";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import KbdShortcut from "@/components/base/KbdShortcut.vue";
import SongEditorPanel from "@/components/editor/SongEditorPanel.vue";
import TimelinePanel from "@/components/editor/timeline/TimelinePanel.vue";
import HeaderBar from "@/components/header/HeaderBar.vue";
import BabySvenja from "@/components/icons/BabySvenja.vue";
import MarkerPanel from "@/components/player/MarkerPanel.vue";
import MixerPanel from "@/components/player/MixerPanel.vue";
import VampCard from "@/components/player/VampCard.vue";
import MeasureGrid from "@/components/score/MeasureGrid.vue";
import ScoreViewer from "@/components/score/ScoreViewer.vue";
import SongDetailsDialog from "@/components/song/SongDetailsDialog.vue";
import { type ShortcutAction, useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import { usePlayerSync } from "@/composables/usePlayerSync";
import { provideSongEditor } from "@/composables/useSongEditor";
import { useSongHistory } from "@/composables/useSongHistory";
import { formatSectionPass } from "@/core/models/scoreOverlays";
import type Song from "@/core/models/song";
import { hasUnsyncedAudio } from "@/core/models/songSetup";
import { getAccessFlags } from "@/pocketbase/auth";
import { useAuthStore } from "@/stores/auth";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { useShowStore } from "@/stores/show";

const auth = useAuthStore();
const settings = useSettingsStore();
const player = usePlayerStore();
const showStore = useShowStore();
const route = useRoute();
const router = useRouter();

const props = defineProps<{
  showId: string;
  songId?: string;
}>();

const { current: show } = storeToRefs(showStore);
const showLoading = ref(true);

const song = ref<Song | undefined>();
const songLoading = ref(true);
const editMode = computed(() => route.name === "song-edit");
const canEdit = computed(() => !!show.value && getAccessFlags(show.value.permissions, auth.user?.id).editor);
const showTimeline = computed(() => editMode.value && !!song.value);
const hasMarkers = computed(() => (song.value?.getMarkers().length ?? 0) > 0);
const hasStartPanel = computed(() => editMode.value || hasMarkers.value);
const isStartPanelOpen = computed(() => hasStartPanel.value && settings.current.workspace.panelVisible.markers);
const isTimelineOpen = computed(() => showTimeline.value && settings.current.workspace.panelVisible.timeline);
const showSyncNotice = computed(() => !!song.value && hasUnsyncedAudio(song.value) && !isTimelineOpen.value);

provideSongEditor(song, editMode);
usePlayerSync(song);
const history = useSongHistory(song, editMode);

// Rehearsers have nothing to do with an empty markers panel. Below lg the song editor's panel is a bottom sheet
// over the score and the timeline, which gets a tab of its own since it needs the width.
const tabs = computed(() => [
  ...(editMode.value || !hasMarkers.value ? [] : [{ value: "markers", label: "Markers" } as const]),
  { value: "score", label: "Score" } as const,
  ...(showTimeline.value ? [{ value: "timeline", label: "Timeline" } as const] : []),
  { value: "mixer", label: "Mixer" } as const,
]);
const selectedTab = computed(() => tabs.value.some(tab => tab.value === settings.current.workspace.selectedTab)
  ? settings.current.workspace.selectedTab
  : "score");

const isSheetLayout = useBreakpoints(breakpointsTailwind).smaller("lg");
const editorPanel = ref();
const { height: editorPanelHeight } = useElementSize(editorPanel, undefined, { box: "border-box" });
const scoreCoveredBottom = computed(() => editMode.value && isSheetLayout.value ? editorPanelHeight.value : 0);

const songs = computed(() => show.value?.songs ?? []);
const songIndex = computed(() => songs.value.findIndex(s => s.id === props.songId));

// Once the current song is deleted it has no index, so its successor is found by where it was.
const lastSongIndex = ref(0);
watch(songIndex, (index) => {
  if (index >= 0) {
    lastSongIndex.value = index;
  }
});

const vampTitle = computed(() => player.currentSection ? formatSectionPass("vamp", player.currentSection) : "Vamp");

const vampCardType = computed(() => {
  if (player.playing) {
    if (player.currentSection?.kind === "vamp" && !player.currentSection.released) {
      return "vamp";
    } else if (player.currentSegue?.enabled && player.currentLocation?.position === player.finalLocation?.position) {
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

// Stepping follows the recording, so a repeated measure is visited once per pass.
function stepMeasure(direction: 1 | -1): void {
  const location = player.ready ? player.currentLocation : undefined;
  if (location) {
    player.seekPosition(location.position + direction);
  }
}

function previousMeasure(): void {
  stepMeasure(-1);
}

function nextMeasure(): void {
  stepMeasure(1);
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

// The open dialog is part of the URL, so reloading keeps it open and the show page can link to it.
const detailsVisible = computed({
  get: () => editMode.value && route.query.details !== undefined,
  set: (visible: boolean) => {
    const { details: _, ...query } = route.query;
    router.replace({ ...route, query: visible ? { ...query, details: "1" } : query });
  },
});

function openSongDetails(): void {
  detailsVisible.value = true;
}

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

  const next = songs.value[lastSongIndex.value] ?? songs.value[lastSongIndex.value - 1];
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

// The player is global, so it would keep playing on pages without a transport.
onUnmounted(() => player.unload());

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

    const loadedShow = await showStore.load(props.showId);
    showLoading.value = false;

    // If no song id was selected, clear the current song
    if (songId === undefined) {
      song.value = undefined;
      return;
    }

    // Select the song
    song.value = loadedShow.songs.find(s => s.id === songId);
    if (!song.value) {
      console.error("Invalid song id:", songId);
      const firstSong = loadedShow.songs[0];
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
    class="grid size-full grid-cols-1 grid-rows-[auto_auto_1fr] gap-2 overflow-hidden p-2 lg:grid-cols-[auto_1fr_auto]"
    :class="showTimeline ? 'lg:grid-rows-[auto_1fr_auto]' : 'lg:grid-rows-[auto_1fr]'"
  >
    <HeaderBar
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
    >
      <template #actions>
        <Button
          v-if="editMode && song"
          label="Details"
          icon="pi pi-file-edit"
          severity="secondary"
          aria-label="Details"
          aria-haspopup="dialog"
          class="flex-none"
          pt:label="hidden sm:inline lg:hidden 2xl:inline"
          @click="openSongDetails"
        />
      </template>
    </HeaderBar>
    <ButtonGroup class="w-full lg:hidden">
      <Button
        v-for="tab in tabs"
        :key="tab.value"
        :label="tab.label"
        :severity="selectedTab === tab.value ? 'primary' : 'secondary'"
        :aria-pressed="selectedTab === tab.value"
        fluid
        @click="settings.update({ workspace: { selectedTab: tab.value } })"
      />
    </ButtonGroup>
    <!--
      desktop: use lg:contents to make the wrapper div invisible and use its contents as direct grid children
      mobile: div acts as a single grid cell where all panels overlap absolutely
    -->
    <div class="relative col-start-1 row-start-3 size-full lg:contents">
      <!-- Markers Panel (player) or Song Editor Panel (editor) -->
      <div
        class="absolute inset-0 transition-all lg:relative lg:inset-auto lg:size-full"
        :class="[
          editMode
            ? ['pointer-events-none z-30 lg:pointer-events-auto lg:z-10', selectedTab === 'mixer' ? 'invisible lg:visible' : '']
            : selectedTab !== 'markers' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : '',
          isStartPanelOpen ? 'lg:w-96' : 'lg:w-0',
        ]"
      >
        <SongEditorPanel
          v-if="editMode"
          ref="editorPanel"
          class="pointer-events-auto absolute inset-x-0 bottom-0 max-h-1/2 min-h-0 lg:inset-0 lg:max-h-none"
          :class="isStartPanelOpen ? 'lg:opacity-100' : 'lg:pointer-events-none lg:opacity-0'"
          :song="song"
          :history="history"
          @open-details="openSongDetails"
        />
        <MarkerPanel
          v-else-if="hasMarkers"
          class="absolute inset-0 min-h-0"
          :class="isStartPanelOpen ? 'lg:opacity-100' : 'lg:opacity-0'"
          :song="song"
        />
        <Button
          v-if="hasStartPanel"
          class="absolute top-2 left-full z-10 hidden transition-all lg:block"
          :class="isStartPanelOpen ? 'rounded-l-none' : ''"
          :aria-label="editMode ? 'Editor panel' : 'Markers panel'"
          :aria-expanded="isStartPanelOpen"
          :icon="`pi ${isStartPanelOpen ? 'pi-chevron-left' : 'pi-chevron-right'}`"
          severity="secondary"
          rounded
          @click="settings.togglePanelVisible('markers')"
        />
      </div>

      <!-- PDF Panel -->
      <div
        class="absolute inset-0 lg:relative lg:inset-auto lg:size-full"
        :class="selectedTab !== 'score' ? 'pointer-events-none invisible lg:pointer-events-auto lg:visible' : ''"
      >
        <div class="absolute inset-0">
          <ScoreViewer
            class="size-full"
            :song="song"
            :edit-mode="editMode"
            :covered-bottom="scoreCoveredBottom"
            @pdf-loading="pdfLoading = $event"
          />
          <MeasureGrid
            v-if="song && !song.pdfFile && song.getMeasures().length > 0"
            class="absolute inset-0 bg-surface"
            :song="song"
            :edit-mode="editMode"
            :covered-bottom="scoreCoveredBottom"
          />
        </div>
        <!-- The dark theme's message background is translucent and would wash out over the white score. -->
        <div
          v-if="showSyncNotice"
          class="absolute top-2 left-1/2 w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-md bg-surface-0 dark:bg-surface-900"
        >
          <Message
            severity="warn"
            size="small"
            icon="pi pi-exclamation-circle"
          >
            Audio not synced yet, measures may not match the recording
          </Message>
        </div>
        <div class="absolute bottom-4 left-1/2 w-[calc(100%-2rem)] -translate-x-1/2 md:w-72 lg:bottom-16">
          <VampCard
            v-if="vampCardType === 'vamp'"
            class="size-full cursor-pointer"
            :title="vampTitle"
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
          <i
            class="pi pi-book text-5xl text-muted-color"
            aria-hidden="true"
          />
          <span class="text-xl font-semibold">No songs yet</span>
          <span class="text-muted-color">Songs appear here as soon as they are added to "{{ show.title }}".</span>
        </div>
        <div
          v-if="player.loading || pdfLoading"
          class="absolute top-0 left-0 flex size-full flex-col items-center justify-center bg-scrim/50 text-scrim-contrast select-none"
          role="status"
        >
          <BabySvenja class="w-full max-w-lg" />
          <p class="text-xl">
            Loading {{ player.loading ? "Recording" : "PDF" }} ...
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
          :show-id="showId"
          :song="song"
          :edit-mode="editMode"
          @open-song-details="openSongDetails"
        />
        <Button
          class="absolute top-2 right-full z-10 hidden transition-all lg:block"
          :class="settings.current.workspace.panelVisible.mixer ? 'rounded-r-none' : ''"
          aria-label="Mixer panel"
          :aria-expanded="settings.current.workspace.panelVisible.mixer"
          :icon="`pi ${settings.current.workspace.panelVisible.mixer ? 'pi-chevron-right' : 'pi-chevron-left'}`"
          severity="secondary"
          rounded
          @click="settings.togglePanelVisible('mixer')"
        />
      </div>
    </div>

    <SongDetailsDialog
      v-if="show && song"
      v-model="detailsVisible"
      :show="show"
      :song="song"
      @saved="onSongSaved"
      @deleted="onSongDeleted"
    />

    <!-- Below lg the timeline shares the panels' grid cell and shows only in its tab. -->
    <TimelinePanel
      v-if="showTimeline && song"
      class="z-20 col-start-1 row-start-3 min-h-0 lg:z-auto lg:col-span-3"
      :class="selectedTab === 'timeline' ? '' : 'max-lg:hidden'"
      :song="song"
    />
  </div>
</template>
