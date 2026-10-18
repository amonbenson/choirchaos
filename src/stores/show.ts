import { defineStore } from "pinia";
import { markRaw, ref } from "vue";

import Show from "@/core/models/show";
import { useAuthStore } from "@/stores/auth";

// Large reference properties cannot change unless the whole show is replaced, so Vue need not track them.
function markReferencesRaw(show: Show): void {
  for (const song of show.songs) {
    song.$midiSystemEvents = markRaw(song.$midiSystemEvents);

    for (const track of song.tracks) {
      track.$midiTrackEvents = markRaw(track.$midiTrackEvents);
    }

    for (const measure of song.measures.items()) {
      measure.$beatTicks = markRaw(measure.$beatTicks);
    }
  }
}

// Every page of a show works on the same instance, so moving between them neither refetches nor drops it.
export const useShowStore = defineStore("show", () => {
  const auth = useAuthStore();

  const current = ref<Show | undefined>();
  let loadedForUserId: string | undefined;

  async function load(showId: string): Promise<Show> {
    if (current.value?.id === showId && loadedForUserId === auth.user?.id) {
      return current.value;
    }

    const userId = auth.user?.id;
    const show = await Show.get(showId);
    markReferencesRaw(show);
    current.value = show;
    loadedForUserId = userId;
    return current.value;
  }

  function release(showId: string | undefined): void {
    if (current.value && current.value.id !== showId) {
      current.value = undefined;
      loadedForUserId = undefined;
    }
  }

  return { current, load, release };
});
