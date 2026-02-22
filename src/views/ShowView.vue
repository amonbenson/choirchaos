<script setup lang="ts">
import Button from "primevue/button";
import ButtonGroup from "primevue/buttongroup";
import { computed, type ComputedRef, markRaw, type Ref, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import MarkerPanel from "@/components/MarkerPanel.vue";
import MixerPanel from "@/components/MixerPanel.vue";
import SongPdfViewer from "@/components/SongPdfViewer.vue";
import TransportBar from "@/components/TransportBar.vue";
import { useGlobalShortcuts } from "@/composables/useGlobalShortcuts";
import Show from "@/core/show/show";
import type Song from "@/core/show/song";
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
const show: Ref<Show | undefined> = ref();
const showLoading = ref(true);

const song: ComputedRef<Song | undefined> = computed(() => show.value?.songs.find(s => s.id === props.songId));
const songLoading = ref(true);

const songs = computed(() => show.value?.songs ?? []);
const songIndex = computed(() => songs.value.findIndex(s => s.id === props.songId));

const autoplayNextSong = ref(false);

useGlobalShortcuts({
  " ": playPause,
  "ArrowLeft": previousMeasure,
  "ArrowRight": nextMeasure,
  "Mod+ArrowLeft": rewind,
  "Mod+ArrowRight": forward,
  "v": toggleVamp,
  "s": toggleSegue,
});

function playPause(): void {
  if (player.playing) {
    player.pause();
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
  player.exitVamp();
}

function toggleSegue(): void {
  if (player.currentSegue !== undefined) {
    player.setSegueEnabled(!player.currentSegue.enabled);
  }
}

function selectSong(songId?: string, autoplay: boolean = false): void {
  autoplayNextSong.value = autoplay;

  // route to the correct song
  if (songId && songId !== props.songId) {
    router.replace({
      name: "song",
      params: {
        showId: props.showId,
        songId,
      },
    });
  }
}

// reload when the show id changes
watch([show, song], async () => {
  if (show.value && song.value) {
    try {
      songLoading.value = true;
      await player.load(song.value!);

      // Start playing immediately
      if (autoplayNextSong.value) {
        autoplayNextSong.value = false;
        player.play();
      }
    } catch (err) {
      console.error(err);
    } finally {
      songLoading.value = false;
    }
  }
});

// handle segue
player.onSegue(() => {
  // Check the current song
  const currentIndex = show.value?.songs.findIndex(s => s.id === song.value?.id) ?? -1;
  if (currentIndex === -1) {
    return;
  }

  // Select the next song
  const nextSong = show.value?.songs[currentIndex + 1];
  if (nextSong) {
    selectSong(nextSong.id, true);
  }
});

// fetch the show data from pocketbase on setup
async function fetchShow(): Promise<void> {
  try {
    showLoading.value = true;
    const showObj = await Show.get(route.params.showId as string);

    // mark expensive/large reference properties as raw so vue doesn't try to make them reactive.
    // They cannot be changed anyway unless the whole show object is replaced
    for (const song of showObj.songs) {
      song.$midiSystemEvents = markRaw(song.$midiSystemEvents);

      for (const track of song.tracks) {
        track.$midiTrackEvents = markRaw(track.$midiTrackEvents);
      }

      for (const measure of song.measures.items()) {
        measure.$beatTicks = markRaw(measure.$beatTicks);
      }
    }

    // // inject missing marker information
    // const res = await axios.get("/test/mti/license_activate.json");
    // for (const song of showObj.songs) {
    //   const mtiSong = res.data.show.songs.find((s: any) => s.title === song.title);
    //   for (const marker of song.events.markers.items()) {
    //     const mtiMarker = mtiSong.changes.markers.find((m: any) => m.location.measure === marker.start[0] && m.location.beat === marker.start[1]+1);
    //     if (!mtiMarker) {
    //       console.error("missing mti marker!");
    //       continue;
    //     }

    //     marker.marker = mtiMarker.text;
    //   }

    //   // await song.update();
    //   // console.log("update!", song.title);
    // }

    // set the show
    show.value = showObj;

    const songObj = showObj.songs.find(s => s.id === props.songId) ?? null;
    if (!songObj) {
      // if no valid song is selected, route to the first song
      selectSong(showObj.songs[0]?.id);
    }
  } catch (err) {
    console.error(err);
  } finally {
    showLoading.value = false;
  }
}

fetchShow();
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
        :severity="settings.current.ui.selectedTab === tab ? 'primary' : 'secondary'"
        fluid
        @click="settings.updateSelectedTab(tab)"
      />
    </ButtonGroup>
    <div
      class="relative h-full w-full transition-all"
      :class="[
        settings.current.ui.selectedTab === 'markers' ? 'block' : 'hidden lg:block',
        settings.current.ui.panelVisible.markers ? 'lg:w-96' : 'lg:w-0'
      ]"
    >
      <MarkerPanel
        class="absolute inset-0 min-h-0"
        :class="[
          settings.current.ui.panelVisible.markers ? 'lg:opacity-100' : 'lg:opacity-0',
        ]"
        :song="song"
      />
      <Button
        class="absolute top-2 left-full z-10 hidden transition-all lg:block"
        :class="settings.current.ui.panelVisible.markers ? 'rounded-l-none' : ''"
        aria-label="Show Markers Panel"
        :icon="`pi ${settings.current.ui.panelVisible.markers ? 'pi-chevron-left' : 'pi-chevron-right'}`"
        severity="secondary"
        rounded
        @click="settings.togglePanelVisible('markers')"
      />
    </div>
    <!-- <PdfViewer
      class="w-full h-full"
      :class="settings.current.ui.selectedTab === 'pdf' ? 'flex' : 'hidden lg:flex'"
      :song="song"
    /> -->
    <SongPdfViewer
      class="h-full w-full"
      :class="settings.current.ui.selectedTab !== 'pdf' ? 'hidden lg:block' : ''"
      :song="song"
    />
    <div
      class="relative h-full w-full transition-all"
      :class="[
        settings.current.ui.selectedTab === 'mixer' ? 'block' : 'hidden lg:block',
        settings.current.ui.panelVisible.mixer ? 'lg:w-96' : 'lg:w-0',
      ]"
    >
      <MixerPanel
        class="absolute inset-0 min-h-0"
        :class="[
          settings.current.ui.panelVisible.mixer ? 'lg:opacity-100' : 'lg:opacity-0',
        ]"
        :song="song"
      />
      <Button
        class="absolute top-2 right-full z-10 hidden transition-all lg:block"
        :class="settings.current.ui.panelVisible.mixer ? 'rounded-r-none' : ''"
        aria-label="Show Markers Panel"
        :icon="`pi ${settings.current.ui.panelVisible.mixer ? 'pi-chevron-right' : 'pi-chevron-left'}`"
        severity="secondary"
        rounded
        @click="settings.togglePanelVisible('mixer')"
      />
    </div>
  </div>
</template>
