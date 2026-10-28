import { type ShallowRef, shallowRef } from "vue";

import { formatSyncPlace } from "@/core/models/locationFormat";
import type { Occurrence } from "@/core/models/recording";
import type Song from "@/core/models/song";
import {
  addSyncPoint,
  getSyncTime,
  isSameSyncPlace,
  moveSyncPoint,
  reassignWarpMarker,
  removeSyncPoint,
  type SyncPlace,
  type SyncPoints,
} from "@/core/models/warpEditing";
import { usePlayerStore } from "@/stores/player";

import { useConfirmDestructive } from "./useConfirmDestructive";
import { useNotify } from "./useNotify";

// Audio mode ticks are milliseconds, warp markers are stored in seconds.
const MILLISECONDS_PER_SECOND = 1000;

export type PendingSyncMove = { place: SyncPlace; time: number };

export type SyncEditor = {
  /** A move that is not saved yet. Repeated nudges only save the latest time. */
  pending: ShallowRef<PendingSyncMove | undefined>;
  getPlayheadTime: () => number;
  getDuration: () => number;
  /** The place's sync point time, including a pending move. */
  getTime: (place: SyncPlace) => number | undefined;
  add: (place: SyncPlace, time: number) => Promise<void>;
  moveTo: (place: SyncPlace, time: number) => Promise<void>;
  syncToPlayhead: (place: SyncPlace) => Promise<void>;
  reassign: (from: Occurrence, to: Occurrence) => Promise<void>;
  /** Asks first, since a removed sync point cannot be brought back. True once removed. */
  remove: (place: SyncPlace) => Promise<boolean>;
};

/**
 * Saves sync point changes the same way from the timeline and the inspector. At most one save runs at a
 * time, so nudges never arrive out of order.
 */
export function useSyncEditor(getSong: () => Song | undefined): SyncEditor {
  const player = usePlayerStore();
  const confirmDestructive = useConfirmDestructive();
  const { notifyError } = useNotify();
  const pending = shallowRef<PendingSyncMove>();
  let draining: Promise<void> | undefined;

  function getPlayheadTime(): number {
    return player.position / MILLISECONDS_PER_SECOND;
  }

  function getDuration(): number {
    return player.duration / MILLISECONDS_PER_SECOND;
  }

  function getTime(place: SyncPlace): number | undefined {
    const move = pending.value;
    if (move && isSameSyncPlace(move.place, place)) {
      return move.time;
    }

    const song = getSong();
    return song && getSyncTime(song.getSyncPoints(), place);
  }

  async function run(change: (song: Song) => SyncPoints, failure: string): Promise<void> {
    const song = getSong();
    if (!song) {
      return;
    }

    try {
      await song.editLayers(change(song));
    } catch (error) {
      notifyError(failure, error);
    }
  }

  async function drain(): Promise<void> {
    while (pending.value) {
      const move = pending.value;
      await run(song => moveSyncPoint(song.getSyncPoints(), move.place, move.time), "Could not move the sync point");
      if (pending.value === move) {
        pending.value = undefined;
      }
    }

    draining = undefined;
  }

  function moveTo(place: SyncPlace, time: number): Promise<void> {
    pending.value = { place, time };
    draining ??= drain();
    return draining;
  }

  function add(place: SyncPlace, time: number): Promise<void> {
    return run(song => addSyncPoint(song.getTimeline(), song.getSyncPoints(), place, time), "Could not add the sync point");
  }

  function syncToPlayhead(place: SyncPlace): Promise<void> {
    const time = getPlayheadTime();
    return getTime(place) === undefined ? add(place, time) : moveTo(place, time);
  }

  function reassign(from: Occurrence, to: Occurrence): Promise<void> {
    return run(
      song => ({ ...song.getSyncPoints(), warpMarkers: reassignWarpMarker(song.getTimeline(), song.getWarpMarkers(), from, to) }),
      "Could not move the sync point to another measure",
    );
  }

  function confirmRemoval(song: Song, place: SyncPlace): Promise<boolean> {
    return confirmDestructive({
      header: "Remove sync point",
      message: `Remove the sync point at ${formatSyncPlace(song, place)}? The measures around it will follow the neighbouring sync points.`,
      accept: "Remove",
    });
  }

  async function remove(place: SyncPlace): Promise<boolean> {
    const song = getSong();
    if (!song || !await confirmRemoval(song, place)) {
      return false;
    }

    await draining;
    await run(target => removeSyncPoint(target.getSyncPoints(), place), "Could not remove the sync point");
    return true;
  }

  return { pending, getPlayheadTime, getDuration, getTime, add, moveTo, syncToPlayhead, reassign, remove };
}
