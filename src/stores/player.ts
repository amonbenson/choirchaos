import { defineStore } from "pinia";
import { markRaw, onScopeDispose } from "vue";

import { useEvent } from "@/composables/event";
import type { NoteEvent } from "@/core/midi/events";
import MidiPlayer, { type MidiPlayerSegueState, type MidiPlayerVampState } from "@/core/midi/player";
import type Song from "@/core/models/song";
import { isNumbering } from "@/core/utils/numbering";

const globalPlayer = new MidiPlayer();

export const usePlayerStore = defineStore("player", () => {
  const status = useEvent(globalPlayer, "statusChanged", { initial: globalPlayer.status });
  const playing = useEvent(globalPlayer, "playingChanged", { initial: globalPlayer.playing });

  const loading = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.status === "loading",
    getter: player => player.status === "loading",
  });

  const ready = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.status === "ready",
    getter: player => player.status === "ready",
  });

  const position = useEvent(globalPlayer, "positionChanged", { initial: globalPlayer.position });

  const duration = useEvent(globalPlayer, "durationChanged", { initial: globalPlayer.duration });

  const currentTempo = useEvent(globalPlayer, "currentTempoChanged", {
    initial: globalPlayer.currentTempo,
  });

  const currentTimeSignature = useEvent(globalPlayer, "currentTimeSignatureChanged", {
    initial: globalPlayer.currentTimeSignature,
  });

  const currentVamp = useEvent<MidiPlayer, MidiPlayerVampState | undefined>(globalPlayer, "currentVampChanged", {
    initial: globalPlayer.currentVamp,
  });

  const currentSegue = useEvent<MidiPlayer, MidiPlayerSegueState | undefined>(globalPlayer, "currentSegueChanged", {
    initial: globalPlayer.currentSegue,
  });

  const currentMeasure = useEvent(globalPlayer, "currentMeasureChanged", {
    initial: globalPlayer.currentMeasure,
  });

  const finalMeasure = useEvent(globalPlayer, "finalMeasureChanged", {
    initial: globalPlayer.finalMeasure,
  });

  const events = useEvent(globalPlayer, "statusChanged", {
    initial: markRaw(globalPlayer.midi_events),
    getter: player => markRaw(player.midi_events),
  });

  const mode = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.mode,
    getter: player => player.mode,
  });

  const ppqn = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.ppqn,
    getter: player => player.ppqn,
  });

  const playbackSpeed = useEvent(globalPlayer, "playbackSpeedChanged", {
    initial: globalPlayer.playbackSpeed,
    getter: player => player.playbackSpeed,
    setter: (player, value) => player.playbackSpeed = value,
  });

  const playbackTransposition = useEvent(globalPlayer, "playbackTranspositionChanged", {
    initial: globalPlayer.playbackTransposition,
    getter: player => player.playbackTransposition,
    setter: (player, value) => player.playbackTransposition = value,
  });

  function seek(position: number): void {
    globalPlayer.seek(position);
  }

  function setMeasure(value: string): void {
    if (!globalPlayer.currentSong) {
      return;
    }

    // validate input
    if (!isNumbering(value)) {
      value = "1";
    }

    // find the measure and seek to its starting beat position
    const measure = globalPlayer.currentSong.findMeasure(value);
    globalPlayer.seek(measure?.$beatTicks[0] ?? 0);
  }

  function setBeat(value: number): void {
    if (!globalPlayer.currentSong) {
      return;
    }

    // find the current measure, validate input range, and seek
    const measure = globalPlayer.currentSong.findMeasure(globalPlayer.currentMeasure[0]);
    const beats = measure?.beats ?? 1;
    if (value < 0) {
      value = 0;
    } else if (value >= beats) {
      value = beats - 1;
    }

    globalPlayer.seek(measure?.$beatTicks[value] ?? 0);
  }

  function onSegue(callback: () => void): void {
    globalPlayer.on("segue", callback);
    onScopeDispose(() => globalPlayer.off("segue", callback));
  }

  function onNote(callback: (event: NoteEvent) => void): void {
    globalPlayer.on("note", callback);
    onScopeDispose(() => globalPlayer.off("note", callback));
  }

  return {
    load: (song: Song) => globalPlayer.load(song),
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
    player: globalPlayer,
  };
});
