<script setup lang="ts">
import Show from "@/core/show/show";
import Song from "@/core/show/song";
import { useProjectStore } from "@/stores/project";
import { usePlayerStore } from "@/stores/player";
import { computed, watch, ref, markRaw, type Ref, type ComputedRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import TransportBar from "./TransportBar.vue";

const player = usePlayerStore();
const route = useRoute();
const router = useRouter();

const props = defineProps<{
  showId: string,
  songId?: string,
}>();

// store show and current song data from pocketbase
const show: Ref<Show | null> = ref(null);
const showLoading = ref(true);

const song: ComputedRef<Show | null> = computed(() => show.value?.songs.find(s => s.id === props.songId) ?? null);
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
  if (show.value) {
    try {
      songLoading.value = true;
      await player.load(song.value);
    } catch (err) {
      console.error(err);
    } finally {
      songLoading.value = false;
    }
  }
});

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
  <div class="fixed left-0 top-0 w-screen h-screen flex flex-col justify-stretch items-stretch gap-2 p-2">
    <TransportBar
      :model-value="songId"
      :songs="show?.songs ?? null"
      :loading="showLoading || songLoading"
      @update:model-value="selectSong($event)"
    />
  </div>
</template>
