<script setup lang="ts">
import { usePromise } from "@/composables/promise";
import Show from "@/core/show/show";
import Song from "@/core/show/song";
import { compareNumberings } from "@/core/utils/numbering";
import { useProjectStore } from "@/stores/project";
import { usePlayerStore } from "@/stores/player";
import { computed, nextTick, onMounted, ref, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";

const project = useProjectStore();
const player = usePlayerStore();
const route = useRoute();
const router = useRouter();

// set initial project params from the router
project.showId = route.params.showId as string;
project.songId = route.params.songId as string ?? null;

// continonusly sync router path with the project's song and track ids
watch(() => project.songId, songId => {
  // construct path
  let path = `/show/${project.showId}`;
  if (songId) {
    path += `/song/${songId}`;
  }

  // update path
  router.replace({ path });
});

// fetch show and current song data from pocketbase
const [show]: [Ref<Show | null>] = usePromise(Show.get(route.params.showId as string));
const songs: Ref<Song[] | null> = computed(() => show.value?.songs ?? null);
const song: Ref<Song | null> = computed(() => songs.value?.find(song => song.id === project.songId) ?? null);

// automatically select the first song
watch([songs, () => project.songId], ([songs, songId]) => {
  const songIds = songs?.map(song => song.id) ?? [];

  // clear project song id
  if (songIds.length === 0) {
    project.songId = null;
    return;
  }

  // select the first song if no other valid song is selected already
  if (!(songId && songIds.includes(songId))) {
    project.songId = songs?.[0]?.id ?? null;
  }
});

// load the selected song into the player
// watch(song, async song => {
//   if (song) {
//     console.log("LOADING SONG...");
//     await player.load(song);
//   }
// });
</script>

<template>
  {{ song }}
</template>
