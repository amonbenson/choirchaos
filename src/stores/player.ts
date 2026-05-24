import { defineStore } from "pinia";
import { computed, type ComputedRef, markRaw, onScopeDispose, ref, shallowRef } from "vue";

import type { NoteEvent } from "@/core/midi/events";
import type Song from "@/core/models/song";
import PlayerEngine, { type PlayerSegueState, type PlayerVampState } from "@/core/player/engine";
import type { Event } from "@/core/utils/events";
import { isNumbering } from "@/core/utils/numbering";

const globalPlayer = new PlayerEngine();

function useEngineEvent<T>(event: Event<T>, initial: T): ComputedRef<T> {
  const value = shallowRef<T>(initial);
  const d = event((v) => {
    value.value = v;
  });
  onScopeDispose(() => d.dispose());

  return computed(() => value.value);
}

export const usePlayerStore = defineStore("player", () => {
  const statusRef = ref(globalPlayer.getStatus());
  const statusD = globalPlayer.onStatusChange((s) => {
    statusRef.value = s;
  });
  onScopeDispose(() => statusD.dispose());

  const status = computed(() => statusRef.value);
  const loading = computed(() => statusRef.value === "loading");
  const ready = computed(() => statusRef.value === "ready");
  const mode = computed(() => globalPlayer.getMode());
  const ppqn = computed(() => globalPlayer.getPpqn());
  const events = computed(() => markRaw(globalPlayer.getMidiEvents()));

  const playing = useEngineEvent(globalPlayer.onPlayingChange, globalPlayer.isPlaying());
  const position = useEngineEvent(globalPlayer.onPositionChange, globalPlayer.getPosition());
  const duration = useEngineEvent(globalPlayer.onDurationChange, globalPlayer.getDuration());
  const currentTempo = useEngineEvent(globalPlayer.onCurrentTempoChange, globalPlayer.getCurrentTempo());
  const currentTimeSignature = useEngineEvent(globalPlayer.onCurrentTimeSignatureChange, globalPlayer.getCurrentTimeSignature());
  const currentMeasure = useEngineEvent(globalPlayer.onCurrentMeasureChange, globalPlayer.getCurrentMeasure());
  const finalMeasure = useEngineEvent(globalPlayer.onFinalMeasureChange, globalPlayer.getFinalMeasure());

  const currentVamp = useEngineEvent<PlayerVampState | undefined>(
    globalPlayer.onCurrentVampChange,
    globalPlayer.getCurrentVamp(),
  );
  const currentSegue = useEngineEvent<PlayerSegueState | undefined>(
    globalPlayer.onCurrentSegueChange,
    globalPlayer.getCurrentSegue(),
  );

  const playbackSpeedRef = ref(globalPlayer.getPlaybackSpeed());
  const playbackSpeedD = globalPlayer.onPlaybackSpeedChange((v) => {
    playbackSpeedRef.value = v;
  });
  onScopeDispose(() => playbackSpeedD.dispose());
  const playbackSpeed = computed({
    get: () => playbackSpeedRef.value,
    set: v => globalPlayer.setPlaybackSpeed(v),
  });

  const playbackTranspositionRef = ref(globalPlayer.getPlaybackTransposition());
  const playbackTranspositionD = globalPlayer.onPlaybackTranspositionChange((v) => {
    playbackTranspositionRef.value = v;
  });
  onScopeDispose(() => playbackTranspositionD.dispose());
  const playbackTransposition = computed({
    get: () => playbackTranspositionRef.value,
    set: v => globalPlayer.setPlaybackTransposition(v),
  });

  const trackAmplitudes = useEngineEvent<number[]>(globalPlayer.onTrackAmplitudesChange, []);

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
    ppqn,
    playbackSpeed,
    playbackTransposition,
    trackAmplitudes,
    player: globalPlayer,
  };
});
