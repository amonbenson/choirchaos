<script setup lang="ts">
import Show from "@/core/show/show";
import { useSettingsStore } from "@/stores/settings";
import { usePlayerStore } from "@/stores/player";
import { computed, watch, ref, markRaw, type Ref, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import TransportBar from "@/components/TransportBar.vue";
import type Song from "@/core/show/song";
import ButtonGroup from "primevue/buttongroup";
import Button from "primevue/button";
import PdfViewer from "@/components/PdfViewer.vue";
import MarkerPanel from "@/components/MarkerPanel.vue";
import MixerPanel from "@/components/MixerPanel.vue";

const settings = useSettingsStore();
const player = usePlayerStore();
const route = useRoute();
const router = useRouter();

const props = defineProps<{
  showId: string,
  songId?: string,
}>();

// store show and current song data from pocketbase
const show: Ref<Show | undefined> = ref();
const showLoading = ref(true);

const song: ComputedRef<Song | undefined> = computed(() => show.value?.songs.find(s => s.id === props.songId));
const songLoading = ref(true);

function selectSong(songId?: string) {
  // route to the correct song first
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
    } catch (err) {
      console.error(err);
    } finally {
      songLoading.value = false;
    }
  }
});

// handle segue
// player.onEndOfSong(() => {
//   if (show.value && song.value?.events.segue) {
//     const currentIndex = show.value.songs.findIndex(s => s.id === props.songId) ?? -1;
//     const nextSong = show.value.songs[currentIndex + 1];
//     if (nextSong) {
//       selectSong(nextSong.id);
//     }
//   }
// });

// fetch the show data from pocketbase on setup
async function fetchShow() {
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
      selectSong(showObj.songs[0].id);
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
  <div class="fixed left-0 top-0 w-screen h-screen grid grid-cols-1 grid-rows-[auto_auto_1fr] lg:grid-cols-[auto_1fr_auto] lg:grid-rows-[auto_1fr] gap-2 p-2">
    <TransportBar
      class="lg:col-span-3"
      :model-value="songId"
      :songs="show?.songs"
      :loading="showLoading || songLoading"
      @update:model-value="selectSong($event)"
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
      class="w-full h-full relative transition-all"
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
        class="absolute left-full top-2 z-10 transition-all hidden lg:block"
        :class="settings.current.ui.panelVisible.markers ? 'rounded-l-none' : ''"
        aria-label="Show Markers Panel"
        :icon="`pi ${settings.current.ui.panelVisible.markers ? 'pi-chevron-left' : 'pi-chevron-right'}`"
        severity="secondary"
        rounded
        @click="settings.togglePanelVisible('markers')"
      />
    </div>
    <PdfViewer
      class="w-full h-full"
      :class="settings.current.ui.selectedTab === 'pdf' ? 'flex' : 'hidden lg:flex'"
      :song="song"
    />
    <div
      class="w-full h-full relative transition-all"
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
        class="absolute right-full top-2 z-10 transition-all hidden lg:block"
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
