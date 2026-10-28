import { type Ref, watch } from "vue";

import type Song from "@/core/models/song";
import type { LayersChange } from "@/core/models/song";
import { usePlayerStore } from "@/stores/player";

import { useNotify } from "./useNotify";

/**
 * Keeps the player in step with every saved change of the song's layers, whoever made it. A new
 * timeline needs a reload at the same playhead time, other changes only re-time sync points and
 * re-resolve sections. Callers never wait for the reload, so no UI state waits for audio to load.
 */
export function usePlayerSync(song: Ref<Song | undefined>): void {
  const player = usePlayerStore();
  const { notifyError } = useNotify();

  async function reload(changed: Song): Promise<void> {
    try {
      await player.load(changed, player.position);
    } catch (error) {
      notifyError("Could not reload the song", error);
    }
  }

  function follow(changed: Song, { timingChanged }: LayersChange): void {
    if (timingChanged) {
      void reload(changed);
    } else {
      player.syncWarp();
    }
  }

  watch(song, (current, _, onCleanup) => {
    const subscription = current?.onLayersChange(change => follow(current, change));
    onCleanup(() => subscription?.dispose());
  }, { immediate: true });
}
