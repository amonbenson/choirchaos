import { defineStore } from "pinia";
import { computed, markRaw, onScopeDispose } from "vue";

import { useEvent } from "@/composables/event";
import type { NoteEvent } from "@/core/midi/events";
import type Song from "@/core/models/song";
import PlayerEngine, { type PlayerSegueState, type PlayerVampState } from "@/core/player/engine";
import { isNumbering } from "@/core/utils/numbering";

const globalPlayer = new PlayerEngine();

export const usePlayerStore = defineStore("player", () => {
  const status = useEvent(globalPlayer.onStatusChange, globalPlayer.getStatus());
  const loading = computed(() => status.value === "loading");
  const ready = computed(() => status.value === "ready");
  const mode = useEvent(globalPlayer.onModeChange, globalPlayer.getMode());

  const events = useEvent(globalPlayer.onStatusChange, markRaw(globalPlayer.getMidiEvents()), {
    getter: () => markRaw(globalPlayer.getMidiEvents()),
  });

  const playing = useEvent(globalPlayer.onPlayingChange, globalPlayer.isPlaying());
  const position = useEvent(globalPlayer.onPositionChange, globalPlayer.getPosition());
  const duration = useEvent(globalPlayer.onDurationChange, globalPlayer.getDuration());
  const currentTempo = useEvent(globalPlayer.onCurrentTempoChange, globalPlayer.getCurrentTempo());
  const currentTimeSignature = useEvent(globalPlayer.onCurrentTimeSignatureChange, globalPlayer.getCurrentTimeSignature());
  const currentMeasure = useEvent(globalPlayer.onCurrentMeasureChange, globalPlayer.getCurrentMeasure());
  const finalMeasure = useEvent(globalPlayer.onFinalMeasureChange, globalPlayer.getFinalMeasure());

  const currentVamp = useEvent<PlayerVampState | undefined>(
    globalPlayer.onCurrentVampChange,
    globalPlayer.getCurrentVamp(),
  );
  const currentSegue = useEvent<PlayerSegueState | undefined>(
    globalPlayer.onCurrentSegueChange,
    globalPlayer.getCurrentSegue(),
  );

  const playbackSpeed = useEvent(
    globalPlayer.onPlaybackSpeedChange,
    globalPlayer.getPlaybackSpeed(),
    { setter: v => globalPlayer.setPlaybackSpeed(v) },
  );
  const playbackTransposition = useEvent(
    globalPlayer.onPlaybackTranspositionChange,
    globalPlayer.getPlaybackTransposition(),
    { setter: v => globalPlayer.setPlaybackTransposition(v) },
  );

  const trackAmplitudes = useEvent<number[]>(globalPlayer.onTrackAmplitudesChange, []);

  function seek(position: number): void {
    globalPlayer.seek(position);
  }

  function setMeasure(value: string): void {
    if (!globalPlayer.getCurrentSong()) {
      return;
    }

    if (!isNumbering(value)) {
      value = "1";
    }

    const measure = globalPlayer.getCurrentSong()!.findMeasure(value);
    globalPlayer.seek(measure?.$beatTicks[0] ?? 0);
  }

  function setBeat(value: number): void {
    if (!globalPlayer.getCurrentSong()) {
      return;
    }

    const measure = globalPlayer.getCurrentSong()!.findMeasure(globalPlayer.getCurrentMeasure()[0]);
    const beats = measure?.beats ?? 1;
    if (value < 0) {
      value = 0;
    } else if (value >= beats) {
      value = beats - 1;
    }

    globalPlayer.seek(measure?.$beatTicks[value] ?? 0);
  }

  function onSegue(callback: () => void): void {
    const d = globalPlayer.onSegue(callback);
    onScopeDispose(() => d.dispose());
  }

  function onNote(callback: (event: NoteEvent) => void): void {
    const d = globalPlayer.onNote(callback);
    onScopeDispose(() => d.dispose());
  }

  return {
    load: (song: Song) => globalPlayer.load(song),
    syncWarp: (song: Song) => globalPlayer.syncWarp(song),
    unload: () => globalPlayer.unload(),
    play: () => globalPlayer.play(),
    pause: () => globalPlayer.pause(),
    stop: () => globalPlayer.stop(),
    exitVamp: () => globalPlayer.exitVamp(),
    resetVamp: () => globalPlayer.resetVamp(),
    toggleVamp: () => globalPlayer.toggleVamp(),
    setSegueEnabled: (enabled: boolean) => globalPlayer.setSegueEnabled(enabled),
    toggleSegue: () => globalPlayer.toggleSegue(),
    seek,
    setMeasure,
    setBeat,
    onNote,
    onSegue,
    status,
    loading,
    ready,
    playing,
    position,
    duration,
    currentTempo,
    currentTimeSignature,
    currentVamp,
    currentSegue,
    currentMeasure,
    finalMeasure,
    events,
    mode,
    playbackSpeed,
    playbackTransposition,
    trackAmplitudes,
    player: globalPlayer,
  };
});
