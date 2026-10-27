import { useConfirm } from "primevue/useconfirm";
import { type ShallowRef, shallowRef } from "vue";

import { formatLocation } from "@/core/models/locationFormat";
import type { Occurrence, StoredWarpMarker } from "@/core/models/recording";
import type Song from "@/core/models/song";
import { addWarpMarker, findWarpMarker, isSameOccurrence, moveWarpMarker, reassignWarpMarker, removeWarpMarker } from "@/core/models/warpEditing";
import { usePlayerStore } from "@/stores/player";

import { useNotify } from "./useNotify";

// Audio mode ticks are milliseconds, warp markers are stored in seconds.
const MILLISECONDS_PER_SECOND = 1000;

export type SyncEditor = {
  /** A move that is not saved yet. Repeated nudges only save the latest time. */
  pending: ShallowRef<StoredWarpMarker | undefined>;
  getPlayheadTime: () => number;
  getDuration: () => number;
  /** The occurrence's sync point time, including a pending move. */
  getTime: (occurrence: Occurrence) => number | undefined;
  add: (occurrence: Occurrence, time: number) => Promise<void>;
  moveTo: (occurrence: Occurrence, time: number) => Promise<void>;
  syncToPlayhead: (occurrence: Occurrence) => Promise<void>;
  reassign: (from: Occurrence, to: Occurrence) => Promise<void>;
  /** Asks first, since a removed sync point cannot be brought back. True once removed. */
  remove: (occurrence: Occurrence) => Promise<boolean>;
};

/**
 * Saves sync point changes the same way from the timeline and the inspector. At most one save runs at a
 * time, so nudges never arrive out of order.
 */
export function useSyncEditor(getSong: () => Song | undefined): SyncEditor {
  const player = usePlayerStore();
  const confirm = useConfirm();
  const { notifyError } = useNotify();
  const pending = shallowRef<StoredWarpMarker>();
  let draining: Promise<void> | undefined;

  function getPlayheadTime(): number {
    return player.position / MILLISECONDS_PER_SECOND;
  }

  function getDuration(): number {
    return player.duration / MILLISECONDS_PER_SECOND;
  }

  function getTime(occurrence: Occurrence): number | undefined {
    const move = pending.value;
    if (move && isSameOccurrence(move, occurrence)) {
      return move.time;
    }

    return findWarpMarker(getSong()?.getWarpMarkers() ?? [], occurrence)?.time;
  }

  async function run(change: (song: Song) => readonly StoredWarpMarker[], failure: string): Promise<void> {
    const song = getSong();
    if (!song) {
      return;
    }

    try {
      await song.editLayers({ warpMarkers: change(song) });
    } catch (error) {
      notifyError(failure, error);
    }
  }

  async function drain(): Promise<void> {
    while (pending.value) {
      const move = pending.value;
      await run(song => moveWarpMarker(song.getWarpMarkers(), move, move.time), "Could not move the sync point");
      if (pending.value === move) {
        pending.value = undefined;
      }
    }

    draining = undefined;
  }

  function moveTo(occurrence: Occurrence, time: number): Promise<void> {
    pending.value = { measure: occurrence.measure, occurrence: occurrence.occurrence, time };
    draining ??= drain();
    return draining;
  }

  function add(occurrence: Occurrence, time: number): Promise<void> {
    return run(song => addWarpMarker(song.getTimeline(), song.getWarpMarkers(), { measure: occurrence.measure, occurrence: occurrence.occurrence, time }), "Could not add the sync point");
  }

  function syncToPlayhead(occurrence: Occurrence): Promise<void> {
    const time = getPlayheadTime();
    return getTime(occurrence) === undefined ? add(occurrence, time) : moveTo(occurrence, time);
  }

  function reassign(from: Occurrence, to: Occurrence): Promise<void> {
    return run(song => reassignWarpMarker(song.getTimeline(), song.getWarpMarkers(), from, to), "Could not move the sync point to another measure");
  }

  function confirmRemoval(song: Song, occurrence: Occurrence): Promise<boolean> {
    return new Promise((resolve) => {
      confirm.require({
        header: "Remove sync point",
        message: `Remove the sync point at ${formatLocation(song, occurrence)}? The measures around it will follow the neighbouring sync points.`,
        icon: "pi pi-exclamation-triangle",
        rejectProps: { label: "Cancel", severity: "secondary", text: true },
        acceptProps: { label: "Remove", severity: "danger" },
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      });
    });
  }

  async function remove(occurrence: Occurrence): Promise<boolean> {
    const song = getSong();
    if (!song || !await confirmRemoval(song, occurrence)) {
      return false;
    }

    await draining;
    await run(target => removeWarpMarker(target.getWarpMarkers(), occurrence), "Could not remove the sync point");
    return true;
  }

  return { pending, getPlayheadTime, getDuration, getTime, add, moveTo, syncToPlayhead, reassign, remove };
}
