import { defineStore } from "pinia";
import { useEvent } from "@/composables/event";
import MidiPlayer from "@/core/show/midiPlayer";
import { computed, markRaw, ref, watch } from "vue";
import type Song from "@/core/show/song";
import { isNumbering } from "@/core/utils/numbering";

const globalPlayer = new MidiPlayer();

function usePlayerPosition(player: MidiPlayer) {
  const playing = useEvent(player, "playingChanged", { initial: player.playing });

  // keep track of the player's internal position
  const playerPosition = ref(player.position);
  const updatePosition = () => {
    playerPosition.value = player.position;
  };

  // update position in a regular interval while playing
  let positionUpdateInterval: NodeJS.Timeout | null = null;
  watch(playing, (value) => {
    if (value && !positionUpdateInterval) {
      positionUpdateInterval = setInterval(updatePosition, 1 / 20);
      updatePosition();
    }

    if (!value && positionUpdateInterval) {
      clearInterval(positionUpdateInterval);
      positionUpdateInterval = null;
      updatePosition();
    }
  });

  // also use the emitted position to update on seek and stop events
  const emittedPosition = useEvent(player, "positionChanged", { initial: player.position });
  watch(emittedPosition, () => updatePosition());

  // inject a setter for seeking
  const position = computed({
    get: () => playerPosition.value,
    set: (value) => player.seek(value),
  });

  return position;
}

// function formatTracks(player: MidiPlayer) {
//   // return emptry tracks
//   if (player.status !== "ready") {
//     return {
//       measures: [],
//       transport: [],
//       midi: [],
//     };
//   }

//   // unpack event lists and return a deep copy
//   return JSON.parse(JSON.stringify({
//     measures: player.tracks.measures.items(),
//     transport: player.tracks.transport.items(),
//     midi: player.tracks.midi.map(({ events, name, program }) => ({ events: events.items(), name, program })),
//   }));
// }

export const usePlayerStore = defineStore("player", () => {
  const status = useEvent(globalPlayer, "statusChanged", { initial: globalPlayer.status });
  const playing = useEvent(globalPlayer, "playingChanged", { initial: globalPlayer.playing });

  const loading = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.status === "loading",
    getter: (player) => player.status === "loading",
  });

  const ready = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.status === "ready",
    getter: (player) => player.status === "ready",
  });

  const position = usePlayerPosition(globalPlayer);

  const duration = useEvent(globalPlayer, "durationChanged", { initial: globalPlayer.duration });

  const currentMeasure = useEvent(globalPlayer, "currentMeasureChanged", {
    initial: globalPlayer.currentMeasure,
  });

  const finalMeasure = useEvent(globalPlayer, "finalMeasureChanged", {
    initial: globalPlayer.finalMeasure,
  });

  const events = useEvent(globalPlayer, "statusChanged", {
    initial: markRaw(globalPlayer.midi_events),
    getter: (player) => markRaw(player.midi_events),
  });

  const ppqn = useEvent(globalPlayer, "statusChanged", {
    initial: globalPlayer.ppqn,
    getter: (player) => player.ppqn,
  });

  function setMeasure(value: string) {
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

  function setBeat(value: number) {
    if (!globalPlayer.currentSong) {
      return;
    }

    // convert to zero-indexd number
    value -= 1;

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

  return {
    load: (song: Song) => globalPlayer.load(song),
    unload: () => globalPlayer.unload(),
    play: () => globalPlayer.play(),
    pause: () => globalPlayer.pause(),
    stop: () => globalPlayer.stop(),
    setMeasure,
    setBeat,
    status,
    loading,
    ready,
    playing,
    position,
    duration,
    currentMeasure,
    finalMeasure,
    events,
    ppqn,
    player: globalPlayer,
  };
});
