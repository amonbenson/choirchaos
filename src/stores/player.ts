import { defineStore } from "pinia";
import { computed, markRaw, onScopeDispose } from "vue";

import { useEvent } from "@/composables/event";
import type { NoteEvent } from "@/core/midi/events";
import type { Occurrence } from "@/core/models/recording";
import type Song from "@/core/models/song";
import PlayerEngine, { type PlayerLocation, type PlayerSectionState, type PlayerSegueState } from "@/core/player/engine";
import { getLocationTick as findLocationTick } from "@/core/player/timeline";

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
  const timeline = useEvent(globalPlayer.onTimelineChange, globalPlayer.getTimeline());
  const currentTempo = useEvent(globalPlayer.onCurrentTempoChange, globalPlayer.getCurrentTempo());
  const currentTimeSignature = useEvent(globalPlayer.onCurrentTimeSignatureChange, globalPlayer.getCurrentTimeSignature());
  const currentLocation = useEvent<PlayerLocation | undefined>(globalPlayer.onCurrentLocationChange, globalPlayer.getCurrentLocation());
  const finalLocation = useEvent<PlayerLocation | undefined>(globalPlayer.onFinalLocationChange, globalPlayer.getFinalLocation());
  /** The timeline entry being played. It stays the same object for all its beats, so readers update once per measure. */
  const currentTimelinePosition = computed(() => currentLocation.value ? timeline.value[currentLocation.value.position] : undefined);

  const currentSection = useEvent<PlayerSectionState | undefined>(
    globalPlayer.onCurrentSectionChange,
    globalPlayer.getCurrentSection(),
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

  /** Reactive: recomputes when the timeline is re-resolved. */
  function getLocationTick(location: Occurrence & { beat: number }): number | undefined {
    return findLocationTick(timeline.value, location);
  }

  function seek(position: number): void {
    globalPlayer.seek(position);
  }

  function seekLocation(location: Occurrence & { beat: number }): void {
    const tick = globalPlayer.getLocationTick(location);
    if (tick !== undefined) {
      globalPlayer.seek(tick);
    }
  }

  function seekPosition(position: number, beat = 0): void {
    const tick = globalPlayer.getPositionTick(position, beat);
    if (tick !== undefined) {
      globalPlayer.seek(tick);
    }
  }

  /** Seeks to the first time the measure with this label plays. Unknown labels are ignored. */
  function setMeasure(label: string): void {
    const measure = globalPlayer.getCurrentSong()?.findMeasureByLabel(label.trim());
    if (measure) {
      seekLocation({ measure: measure.id, occurrence: 1, beat: 0 });
    }
  }

  /** Seeks to a 0-based beat of the current position, clamped to its beats. */
  function setBeat(beat: number): void {
    const location = globalPlayer.getCurrentLocation();
    if (location) {
      seekPosition(location.position, beat);
    }
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
    load: (song: Song, startPosition?: number) => globalPlayer.load(song, startPosition),
    syncWarp: () => globalPlayer.syncWarp(),
    unload: () => globalPlayer.unload(),
    play: () => globalPlayer.play(),
    pause: () => globalPlayer.pause(),
    stop: () => globalPlayer.stop(),
    releaseVamp: () => globalPlayer.releaseVamp(),
    resetVamp: () => globalPlayer.resetVamp(),
    toggleVamp: () => globalPlayer.toggleVamp(),
    setVampsEnabled: (enabled: boolean) => globalPlayer.setVampsEnabled(enabled),
    setSegueEnabled: (enabled: boolean) => globalPlayer.setSegueEnabled(enabled),
    toggleSegue: () => globalPlayer.toggleSegue(),
    seek,
    seekLocation,
    seekPosition,
    setMeasure,
    setBeat,
    getLocationTick,
    onNote,
    onSegue,
    status,
    loading,
    ready,
    playing,
    position,
    duration,
    timeline,
    currentTempo,
    currentTimeSignature,
    currentLocation,
    currentTimelinePosition,
    finalLocation,
    currentSection,
    currentSegue,
    events,
    mode,
    playbackSpeed,
    playbackTransposition,
    trackAmplitudes,
    player: globalPlayer,
  };
});
