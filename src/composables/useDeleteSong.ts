import type Show from "@/core/models/show";
import type Song from "@/core/models/song";

import { useConfirmDestructive } from "./useConfirmDestructive";
import { useNotify } from "./useNotify";

/** Deletes a song after asking, from the song list and from the song details alike. True once it is deleted. */
export function useDeleteSong(): (show: Show, song: Song) => Promise<boolean> {
  const confirmDestructive = useConfirmDestructive();
  const { notifyError } = useNotify();

  return async (show, song) => {
    const confirmed = await confirmDestructive({
      header: "Delete song",
      message: `Song ${song.number} "${song.title}" will be deleted permanently, including its score and recordings.`,
      accept: "Delete song",
    });
    if (!confirmed) {
      return false;
    }

    try {
      await show.deleteSong(song);
      return true;
    } catch (error) {
      notifyError("Could not delete the song", error);
      return false;
    }
  };
}
