import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VampVocals } from "@/core/models/sections";
import type Song from "@/core/models/song";
import {
  BEAT_MAP_LABELS,
  idOf,
  makeMidiBuffer,
  makeMidiSong,
  makeMidiSongWithBakedVamp,
  makeMidiSongWithCut,
  makeMidiSongWithRepeat,
  makeMidiSongWithVamp,
  makeMtiJson,
  positionTick,
  TICKS,
  TRACK_NAMES,
} from "@/test/fixtures";
import { ManualUpdater, stepPast, stepUntil } from "@/test/updater";

import type { NoteEvent } from "../midi/events";
import PlayerEngine from "./engine";

vi.mock("axios");

type BeatMapLabels = readonly string[];

function makePlayer(): { player: PlayerEngine; updater: ManualUpdater; ctx: AudioContext } {
  const ctx = new AudioContext();
  let updater!: ManualUpdater;
  const player = new PlayerEngine(ctx, (cb) => {
    updater = new ManualUpdater(cb);
    return updater;
  });
  return { player, updater, ctx };
}

function mockAxios(labels: BeatMapLabels = BEAT_MAP_LABELS.plain): void {
  vi.mocked(axios.get)
    .mockResolvedValueOnce({ data: makeMidiBuffer() })
    .mockResolvedValueOnce({ data: makeMtiJson(labels) });
}

/** Records every timeline position the player shows, in order. */
function recordPositions(player: PlayerEngine): number[] {
  const positions = [player.getCurrentLocation()?.position ?? -1];
  player.onCurrentLocationChange((location) => {
    if (location && positions.at(-1) !== location.position) {
      positions.push(location.position);
    }
  });
  return positions;
}

function queuedPitches(): number[] {
  const wafPlayer = new (window as any).WebAudioFontPlayer();
  return (wafPlayer.queueWaveTable as ReturnType<typeof vi.fn>).mock.calls.map((args: unknown[]) => args[4] as number);
}

describe("PlayerEngine – MIDI mode", () => {
  let player: PlayerEngine;
  let updater: ManualUpdater;
  let ctx: AudioContext;

  async function reload(song: Song, labels?: BeatMapLabels): Promise<void> {
    mockAxios(labels);
    await player.load(song);
  }

  beforeEach(async () => {
    ({ player, updater, ctx } = makePlayer());
    await reload(makeMidiSong());
  });

  afterEach(async () => {
    player.unload();
    await ctx.close();
    vi.clearAllMocks();
  });

  // ── status lifecycle ──────────────────────────────────────────────────────

  it("reaches ready status after load", () => {
    expect(player.getStatus()).toBe("ready");
  });

  it("returns to idle after unload and clears the timeline", () => {
    player.unload();
    expect(player.getStatus()).toBe("idle");
    expect(player.getTimeline()).toEqual([]);
    expect(player.getCurrentLocation()).toBeUndefined();
  });

  it("emits statusChanged events during load", async () => {
    const { player: p2, ctx: ctx2 } = makePlayer();
    const statuses: string[] = [];
    p2.onStatusChange(s => statuses.push(s as string));

    mockAxios();
    await p2.load(makeMidiSong());

    expect(statuses).toEqual(["loading", "ready"]);

    p2.unload();
    await ctx2.close();
  });

  it("stays idle when unloaded while a load is in progress", async () => {
    const { player: p2, ctx: ctx2 } = makePlayer();

    mockAxios();
    const loading = p2.load(makeMidiSong());
    p2.unload();
    await loading;

    expect(p2.getStatus()).toBe("idle");

    await ctx2.close();
  });

  it("fails to load when the beat map does not fit the recording", async () => {
    mockAxios(BEAT_MAP_LABELS.plain);
    await expect(player.load(makeMidiSongWithBakedVamp())).rejects.toThrow("The beat map has 5 measures, but the recording plays 8.");
    expect(player.getStatus()).toBe("idle");
  });

  // ── timeline ──────────────────────────────────────────────────────────────

  it("exposes the timed timeline and the final location", () => {
    const song = player.getCurrentSong()!;
    expect(player.getTimeline().map(p => p.beatTicks[0])).toEqual([0, 480, 2400, 4320, 6240]);
    expect(player.getFinalLocation()).toEqual({ position: 4, measure: idOf(song, "4"), occurrence: 1, beat: 3 });
  });

  it("collects the tracks that play in each position", () => {
    expect(player.getActiveTrackIndices().map(indices => [...indices])).toEqual([[], [0], [0], [1], []]);
  });

  it("finds the tick of a location", () => {
    const song = player.getCurrentSong()!;
    expect(player.getLocationTick({ measure: idOf(song, "2"), occurrence: 1, beat: 2 })).toBe(TICKS.measure2 + 960);
    expect(player.getPositionTick(3)).toBe(TICKS.measure3);
  });

  // ── seek ──────────────────────────────────────────────────────────────────

  it("seek to measure 2 sets the current location", () => {
    player.seek(TICKS.measure2 + 500);
    expect(player.getCurrentLocation()).toEqual({ position: 2, measure: idOf(player.getCurrentSong()!, "2"), occurrence: 1, beat: 1 });
  });

  it("seek past the tempo change sets currentTempo to 140", () => {
    player.seek(TICKS.measure3 + 1);
    expect(player.getCurrentTempo()).toBe(140);
  });

  it("stop resets position to 0", () => {
    player.seek(TICKS.measure2);
    player.stop();
    expect(player.getPosition()).toBe(0);
  });

  it("duration ends where the terminal measure starts", () => {
    expect(player.getDuration()).toBe(TICKS.duration);
  });

  // ── note events ───────────────────────────────────────────────────────────

  it("emits note events for instrument track when stepping past tick 480", () => {
    const notes: NoteEvent[] = [];
    player.onNote(e => notes.push(e));

    player.play();
    stepPast(updater, player, TICKS.measure1 + 10);

    const instrumentNotes = notes.filter(n => n.trackIndex === 0);
    expect(instrumentNotes.length).toBeGreaterThan(0);
    expect(instrumentNotes[0]!.pitch).toBe(60);
  });

  it("emits note events for vocals track when stepping past tick 4320", () => {
    const notes: NoteEvent[] = [];
    player.onNote(e => notes.push(e));

    player.play();
    stepPast(updater, player, TICKS.measure3 + 10);

    const vocalNotes = notes.filter(n => n.trackIndex === 1);
    expect(vocalNotes.length).toBeGreaterThan(0);
    expect(vocalNotes[0]!.pitch).toBe(67);
  });

  it("does not emit note events during seek (only during play)", () => {
    const notes: NoteEvent[] = [];
    player.onNote(e => notes.push(e));
    player.seek(TICKS.measure2);
    expect(notes).toHaveLength(0);
  });

  // ── tempo change ──────────────────────────────────────────────────────────

  it("updates currentTempo when a TEMPO event is stepped through", () => {
    expect(player.getCurrentTempo()).toBe(120);
    player.play();
    stepPast(updater, player, TICKS.measure3 + 10);
    expect(player.getCurrentTempo()).toBe(140);
  });

  // ── playback controls ─────────────────────────────────────────────────────

  it("emits playingChanged true on play and false on pause", () => {
    const events: boolean[] = [];
    player.onPlayingChange(v => events.push(v));
    player.play();
    player.pause();
    expect(events).toEqual([true, false]);
  });

  it("position does not advance while paused", () => {
    player.play();
    stepPast(updater, player, TICKS.measure1);
    player.pause();
    const posAfterPause = player.getPosition();
    updater.step(0.1);
    expect(player.getPosition()).toBe(posAfterPause);
  });

  it("auto-pauses and clamps position at duration when end is reached", () => {
    player.play();
    stepPast(updater, player, TICKS.duration);
    expect(player.isPlaying()).toBe(false);
    expect(player.getPosition()).toBe(TICKS.duration);
  });

  it("plays every position of a plain recording once", () => {
    const positions = recordPositions(player);
    player.play();
    stepPast(updater, player, TICKS.duration);
    expect(positions).toEqual([0, 1, 2, 3, 4]);
  });

  // ── vamp recorded once ────────────────────────────────────────────────────

  describe("vamp recorded once", () => {
    beforeEach(async () => {
      await reload(makeMidiSongWithVamp());
    });

    it("enters the vamp when the position first crosses its start", () => {
      player.play();
      stepPast(updater, player, TICKS.measure2 + 10);

      expect(player.getCurrentSection()).toEqual({ section: 0, kind: "vamp", pass: 1, passes: 2, recordedPasses: 1, released: false });
    });

    it("jumps back at the vamp end for the second pass", () => {
      player.play();
      stepUntil(updater, () => (player.getCurrentSection()?.pass ?? 0) > 1);

      expect(player.getCurrentSection()?.pass).toBe(2);
      expect(player.getPosition()).toBeLessThan(TICKS.measure3);
    });

    it("leaves the vamp after the last pass", () => {
      const positions = recordPositions(player);
      player.play();
      stepUntil(updater, () => player.getCurrentSection() !== undefined);
      stepUntil(updater, () => player.getCurrentSection() === undefined);

      expect(player.getPosition()).toBeGreaterThanOrEqual(TICKS.measure3);
      expect(positions).toEqual([0, 1, 2, 3]);
    });

    it("does not emit notes at or beyond the vamp end during the first pass", () => {
      const allNotes: NoteEvent[] = [];
      player.onNote(e => allNotes.push(e));

      player.play();
      stepUntil(updater, () => (player.getCurrentSection()?.pass ?? 0) >= 2);

      expect(player.getPosition()).toBeLessThan(TICKS.measure3);
      expect(allNotes.filter(n => n.tick >= TICKS.measure3)).toHaveLength(0);
    });

    it("emits notes at the vamp end after the vamp exits", () => {
      const allNotes: NoteEvent[] = [];
      player.onNote(e => allNotes.push(e));

      player.play();
      stepUntil(updater, () => player.getCurrentSection() !== undefined);
      stepUntil(updater, () => player.getCurrentSection() === undefined);
      stepPast(updater, player, TICKS.measure3 + 10);

      expect(allNotes.filter(n => n.pitch === 67 && n.trackIndex === 1).length).toBeGreaterThan(0);
    });

    it("does not show a position beyond the vamp end before the last pass", () => {
      const positions = recordPositions(player);
      player.play();
      stepUntil(updater, () => (player.getCurrentSection()?.pass ?? 0) >= 2);

      expect(positions).not.toContain(3);
    });

    it("leaves at the end of the current pass once released", () => {
      player.play();
      stepPast(updater, player, TICKS.measure2 + 10);
      player.releaseVamp();

      expect(player.getCurrentSection()).toMatchObject({ pass: 1, passes: 1, released: true });
      stepUntil(updater, () => player.getCurrentSection() === undefined);
      expect(player.getPosition()).toBeGreaterThanOrEqual(TICKS.measure3);
    });

    it("toggles between released and vamping", () => {
      player.seek(TICKS.measure2 + 10);
      player.toggleVamp();
      expect(player.getCurrentSection()?.released).toBe(true);
      player.toggleVamp();
      expect(player.getCurrentSection()?.released).toBe(false);
    });
  });

  it("does not schedule audio for notes in the danger zone before a jump", async () => {
    // Notes within AUDIO_CLOCK_OFFSET (100ms = 160 ticks at 120 BPM) before a jump are scheduled
    // 100ms in the future by queueWaveTable and would sound after it. The visual onNote callback
    // must still fire, but queueWaveTable must be suppressed.
    const { parseArrayBuffer } = await import("midi-json-parser");
    vi.mocked(parseArrayBuffer).mockResolvedValueOnce({
      tracks: [
        [],
        [
          { delta: 0, trackName: TRACK_NAMES.instrument },
          { delta: 480, noteOn: { noteNumber: 60, velocity: 80 } } as any,
          { delta: 240, noteOff: { noteNumber: 60, velocity: 0 } } as any,
        ],
        [
          { delta: 0, trackName: TRACK_NAMES.vocals },
          { delta: 4280, noteOn: { noteNumber: 65, velocity: 80 } } as any,
          { delta: 480, noteOff: { noteNumber: 65, velocity: 0 } } as any,
        ],
      ],
    } as any);
    await reload(makeMidiSongWithVamp());
    (new (window as any).WebAudioFontPlayer().queueWaveTable as ReturnType<typeof vi.fn>).mockClear();

    const allNotes: NoteEvent[] = [];
    player.onNote(e => allNotes.push(e));

    player.play();
    stepUntil(updater, () => (player.getCurrentSection()?.pass ?? 0) >= 2);

    expect(allNotes.filter(n => n.pitch === 65).length).toBeGreaterThan(0);
    expect(queuedPitches()).not.toContain(65);
  });

  // ── baked vamp ────────────────────────────────────────────────────────────

  describe("baked vamp", () => {
    // Measure "2" is recorded four times, at positions 2 to 5.

    it("plays the first and the last recorded pass for 2 passes", async () => {
      await reload(makeMidiSongWithBakedVamp({ passes: 2 }), BEAT_MAP_LABELS.bakedVamp);
      const positions = recordPositions(player);
      const passes: number[] = [];
      player.onCurrentSectionChange(section => section && passes.push(section.pass));

      player.play();
      stepPast(updater, player, player.getDuration());

      expect(positions).toEqual([0, 1, 2, 5, 6, 7]);
      expect(passes).toEqual([1, 2]);
    });

    it("plays the recording unchanged when the passes match", async () => {
      await reload(makeMidiSongWithBakedVamp({ passes: 4 }), BEAT_MAP_LABELS.bakedVamp);
      const positions = recordPositions(player);

      player.play();
      stepPast(updater, player, player.getDuration());

      expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });

    it("plays a disabled vamp as recorded", async () => {
      await reload(makeMidiSongWithBakedVamp({ passes: 2 }), BEAT_MAP_LABELS.bakedVamp);
      player.setVampsEnabled(false);
      const positions = recordPositions(player);

      player.play();
      stepPast(updater, player, player.getDuration());

      expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(player.getCurrentSection()).toBeUndefined();
    });

    it("restores the tempo at the jump target", async () => {
      // The tempo changes to 140 BPM at position 3, which the jump from position 2 to 5 skips.
      await reload(makeMidiSongWithBakedVamp({ passes: 2 }), BEAT_MAP_LABELS.bakedVamp);
      player.play();
      stepUntil(updater, () => player.getCurrentLocation()?.position === 5);

      expect(player.getCurrentTempo()).toBe(140);
    });

    it("finishes the pass after a release past its first barline and then plays the last recorded pass", async () => {
      await reload(makeMidiSongWithBakedVamp({ passes: 0 }), BEAT_MAP_LABELS.bakedVamp);
      const positions = recordPositions(player);

      player.play();
      stepUntil(updater, () => player.getCurrentLocation()?.position === 3);
      player.releaseVamp();
      stepPast(updater, player, player.getDuration());

      expect(positions).toEqual([0, 1, 2, 3, 5, 6, 7]);
    });

    it("mutes vocal notes while repeating when only the first pass has vocals", async () => {
      await reload(makeMidiSongWithBakedVamp({ passes: 4, vocals: "first" }), BEAT_MAP_LABELS.bakedVamp);
      const notes: NoteEvent[] = [];
      player.onNote(e => notes.push(e));

      player.play();
      stepPast(updater, player, positionTick(4));

      // The vocal notes lie in position 3, the second recorded pass.
      expect(notes.filter(n => n.trackIndex === 1)).toHaveLength(2);
      expect(queuedPitches()).toContain(60);
      expect(queuedPitches()).not.toContain(67);
    });

    it("still plays notes just before a pass boundary that needs no jump", async () => {
      // The step stops at position 3, where the vocals mute, and continues there without a jump.
      const { parseArrayBuffer } = await import("midi-json-parser");
      vi.mocked(parseArrayBuffer).mockResolvedValueOnce({
        tracks: [
          [],
          [
            { delta: 0, trackName: TRACK_NAMES.instrument },
            { delta: positionTick(3) - 40, noteOn: { noteNumber: 62, velocity: 80 } } as any,
            { delta: 240, noteOff: { noteNumber: 62, velocity: 0 } } as any,
          ],
          [{ delta: 0, trackName: TRACK_NAMES.vocals }],
        ],
      } as any);
      await reload(makeMidiSongWithBakedVamp({ passes: 4, vocals: "first" }), BEAT_MAP_LABELS.bakedVamp);

      player.play();
      stepPast(updater, player, positionTick(4));

      expect(queuedPitches()).toContain(62);
    });

    it("uses the whole step when it stops at a pass boundary without a jump", async () => {
      const positionAfterStep = async (vocals: VampVocals): Promise<number> => {
        await reload(makeMidiSongWithBakedVamp({ passes: 4, vocals }), BEAT_MAP_LABELS.bakedVamp);
        player.seek(positionTick(3) - 10);
        player.play();
        updater.step(0.02);
        return player.getPosition();
      };

      // Only "first" mutes from position 3 on, so only it stops there.
      expect(await positionAfterStep("first")).toBeCloseTo(await positionAfterStep("all"), 6);
    });

    it("keeps vocal notes when every pass has vocals", async () => {
      await reload(makeMidiSongWithBakedVamp({ passes: 4, vocals: "all" }), BEAT_MAP_LABELS.bakedVamp);

      player.play();
      stepPast(updater, player, positionTick(4));

      expect(queuedPitches()).toContain(67);
    });
  });

  // ── repeat and cut ────────────────────────────────────────────────────────

  describe("repeat", () => {
    // Measures "2" and "3" are recorded three times, at positions 2 to 7.

    it("plays all recorded passes when the passes match", async () => {
      await reload(makeMidiSongWithRepeat(3), BEAT_MAP_LABELS.repeat);
      const positions = recordPositions(player);
      const passes: number[] = [];
      player.onCurrentSectionChange(section => section && passes.push(section.pass));

      player.play();
      stepPast(updater, player, player.getDuration());

      expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
      expect(passes).toEqual([1, 2, 3]);
    });

    it("skips to the last recorded pass for fewer passes", async () => {
      await reload(makeMidiSongWithRepeat(2), BEAT_MAP_LABELS.repeat);
      const positions = recordPositions(player);

      player.play();
      stepPast(updater, player, player.getDuration());

      expect(positions).toEqual([0, 1, 2, 3, 6, 7, 8]);
    });

    it("shows the same measure for every pass", async () => {
      await reload(makeMidiSongWithRepeat(3), BEAT_MAP_LABELS.repeat);
      const song = player.getCurrentSong()!;
      player.seek(positionTick(6));

      expect(player.getCurrentLocation()).toEqual({ position: 6, measure: idOf(song, "2"), occurrence: 3, beat: 0 });
      expect(player.getCurrentSection()).toMatchObject({ kind: "repeat", pass: 3, passes: 3, recordedPasses: 3 });
    });
  });

  it("skips a cut", async () => {
    await reload(makeMidiSongWithCut());
    const positions = recordPositions(player);

    player.play();
    stepPast(updater, player, player.getDuration());

    expect(positions).toEqual([0, 1, 4]);
  });

  // ── segue ─────────────────────────────────────────────────────────────────

  it("emits segue when reaching the end with segue enabled", async () => {
    const song = makeMidiSong();
    vi.spyOn(song, "hasSegue").mockReturnValue(true);
    await reload(song);

    const segueEmitted = vi.fn();
    player.onSegue(segueEmitted);

    player.play();
    stepPast(updater, player, TICKS.duration);

    expect(segueEmitted).toHaveBeenCalledOnce();
  });
});
