import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMidiBuffer, makeMidiSong, makeMidiSongWithVamp, makeMtiJson, TICKS, TRACK_NAMES } from "@/test/fixtures";
import { ManualUpdater } from "@/test/updater";

import type { NoteEvent } from "../midi/events";
import PlayerEngine from "./engine";

vi.mock("axios");

// rubberband-web imports tone (broken ESM, extensionless imports) which fails in Node.
vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));

// Replace midi-json-parser (uses Web Workers, unavailable in jsdom/node) with a
// synchronous mock returning the event structure our fixture MIDI_TRACKS produces.
vi.mock("midi-json-parser", () => ({
  parseArrayBuffer: vi.fn().mockResolvedValue({
    tracks: [
      [],
      [
        { delta: 0, trackName: TRACK_NAMES.instrument },
        { delta: 480, noteOn: { noteNumber: 60, velocity: 80 } },
        { delta: 240, noteOff: { noteNumber: 60, velocity: 0 } },
        { delta: 1680, noteOn: { noteNumber: 64, velocity: 80 } },
        { delta: 240, noteOff: { noteNumber: 64, velocity: 0 } },
      ],
      [
        { delta: 0, trackName: TRACK_NAMES.vocals },
        { delta: 4320, noteOn: { noteNumber: 67, velocity: 80 } },
        { delta: 480, noteOff: { noteNumber: 67, velocity: 0 } },
        { delta: 480, noteOn: { noteNumber: 69, velocity: 80 } },
        { delta: 480, noteOff: { noteNumber: 69, velocity: 0 } },
      ],
    ],
  }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlayer(): { player: PlayerEngine; updater: ManualUpdater; ctx: AudioContext } {
  const ctx = new AudioContext();
  let updater!: ManualUpdater;
  const player = new PlayerEngine(ctx, (cb) => {
    updater = new ManualUpdater(cb);
    return updater;
  });
  return { player, updater, ctx };
}

function mockAxios(): void {
  vi.mocked(axios.get)
    .mockResolvedValueOnce({ data: makeMidiBuffer() })
    .mockResolvedValueOnce({ data: makeMtiJson() });
}

function stepPast(updater: ManualUpdater, player: PlayerEngine, targetTick: number): void {
  for (let i = 0; i < 10_000; i++) {
    if (player.getPosition() > targetTick) {
      break;
    }

    if (!updater.isRunning()) {
      break;
    }

    updater.step(0.02);
  }

  if (updater.isRunning()) {
    updater.step(0.02);
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PlayerEngine – MIDI mode", () => {
  let player: PlayerEngine;
  let updater: ManualUpdater;
  let ctx: AudioContext;

  beforeEach(async () => {
    ({ player, updater, ctx } = makePlayer());
    mockAxios();
    await player.load(makeMidiSong());
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

  it("returns to idle after unload", () => {
    player.unload();
    expect(player.getStatus()).toBe("idle");
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

  // ── seek ──────────────────────────────────────────────────────────────────

  it("seek to measure 2 sets currentMeasure to ['2', 0]", () => {
    player.seek(TICKS.measure2);
    expect(player.getCurrentMeasure()).toEqual(["2", 0]);
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

  // ── duration ─────────────────────────────────────────────────────────────

  it("duration equals last-measure start + tickLength (8160)", () => {
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

  // ── vamp ─────────────────────────────────────────────────────────────────

  it("enters a vamp when position first crosses its start tick", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    vp.play();
    stepPast(vu, vp, TICKS.measure2 + 10);

    expect(vp.getCurrentVamp()).toBeDefined();
    vp.unload();
    await vc.close();
  });

  it("wraps position back after crossing vamp end (first loop)", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    vp.play();
    for (let i = 0; i < 10_000 && (vp.getCurrentVamp()?.currentIteration ?? 0) === 0; i++) {
      vu.step(0.02);
    }

    expect(vp.getCurrentVamp()).toBeDefined();
    expect(vp.getCurrentVamp()!.currentIteration).toBeGreaterThan(0);
    expect(vp.getPosition()).toBeLessThan(TICKS.measure3);

    vp.unload();
    await vc.close();
  });

  it("exits vamp after reaching max iterations", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp()); // 2 iterations

    vp.play();
    for (let i = 0; i < 10_000 && vp.getCurrentVamp() === undefined; i++) {
      vu.step(0.02);
    }

    for (let i = 0; i < 10_000 && vp.getCurrentVamp() !== undefined; i++) {
      vu.step(0.02);
    }

    expect(vp.getCurrentVamp()).toBeUndefined();
    expect(vp.getPosition()).toBeGreaterThanOrEqual(TICKS.measure3);

    vp.unload();
    await vc.close();
  });

  it("does not emit notes at or beyond vamp end tick during repeat iterations", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp()); // vamp: [2400, 4320), 2 iterations

    const allNotes: NoteEvent[] = [];
    vp.onNote(e => allNotes.push(e));

    vp.play();

    // Step until the first iteration completes (currentIteration becomes 1)
    for (let i = 0; i < 10_000 && (vp.getCurrentVamp()?.currentIteration ?? 0) < 1; i++) {
      vu.step(0.02);
    }

    expect(vp.getCurrentVamp()?.currentIteration).toBe(1);
    expect(vp.getPosition()).toBeLessThan(TICKS.measure3);

    // Notes at ticks >= vamp.end (measure 3) must not have fired during a repeat
    const notesAtOrBeyondVampEnd = allNotes.filter(n => n.tick >= TICKS.measure3);
    expect(notesAtOrBeyondVampEnd).toHaveLength(0);

    vp.unload();
    await vc.close();
  });

  it("does not schedule audio for notes in the danger zone near vamp end during iterations", async () => {
    // Danger zone: notes within AUDIO_CLOCK_OFFSET (100ms = 96 ticks at 120 BPM) before
    // vamp.end are scheduled 100ms in the future by queueWaveTable. Without the fix, these
    // play during the next iteration after the vamp jump fires. The visual onNote callback
    // must still fire (so the UI stays correct), but queueWaveTable must be suppressed.
    const { player: vp, updater: vu, ctx: vc } = makePlayer();

    // Inject a note at tick 4280 — inside danger zone [4224, 4320) with vamp.end=4320
    const { parseArrayBuffer } = await import("midi-json-parser");
    vi.mocked(parseArrayBuffer).mockResolvedValueOnce({
      tracks: [
        [],
        [
          { delta: 0, trackName: TRACK_NAMES.instrument },
          { delta: 480, noteOn: { noteNumber: 60, velocity: 80 } },
          { delta: 240, noteOff: { noteNumber: 60, velocity: 0 } },
        ],
        [
          { delta: 0, trackName: TRACK_NAMES.vocals },
          { delta: 4280, noteOn: { noteNumber: 65, velocity: 80 } }, // F4 at tick 4280, in danger zone
          { delta: 480, noteOff: { noteNumber: 65, velocity: 0 } },
        ],
      ],
    });
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    const wafPlayer = new (window as any).WebAudioFontPlayer();
    (wafPlayer.queueWaveTable as ReturnType<typeof vi.fn>).mockClear();

    const allNotes: NoteEvent[] = [];
    vp.onNote(e => allNotes.push(e));

    vp.play();

    // Step until first iteration completes (currentIteration becomes 1)
    for (let i = 0; i < 10_000 && (vp.getCurrentVamp()?.currentIteration ?? 0) < 1; i++) {
      vu.step(0.02);
    }

    expect(vp.getCurrentVamp()?.currentIteration).toBe(1);

    // Visual callback must fire for the danger-zone note (UI needs it)
    const dangerZoneNotes = allNotes.filter(n => n.pitch === 65);
    expect(dangerZoneNotes.length).toBeGreaterThan(0);

    // But queueWaveTable must NOT have been called with pitch 65 during the iteration
    const scheduledPitches = (wafPlayer.queueWaveTable as ReturnType<typeof vi.fn>).mock.calls
      .map((args: unknown[]) => args[4]);
    expect(scheduledPitches).not.toContain(65);

    vp.unload();
    await vc.close();
  });

  it("emits notes at vamp end after the vamp fully exits", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    const allNotes: NoteEvent[] = [];
    vp.onNote(e => allNotes.push(e));

    vp.play();

    // Wait for the vamp to exit entirely, then step past the vocal note at tick 4320
    for (let i = 0; i < 10_000 && vp.getCurrentVamp() !== undefined; i++) {
      vu.step(0.02);
    }

    stepPast(vu, vp, TICKS.measure3 + 10);

    expect(vp.getCurrentVamp()).toBeUndefined();
    const vocalG4 = allNotes.filter(n => n.pitch === 67 && n.trackIndex === 1);
    expect(vocalG4.length).toBeGreaterThan(0);

    vp.unload();
    await vc.close();
  });

  it("does not show a measure beyond the vamp end during repeat iterations", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    const measuresShown: string[] = [];
    vp.onCurrentMeasureChange(m => measuresShown.push(m[0]));

    vp.play();

    for (let i = 0; i < 10_000 && (vp.getCurrentVamp()?.currentIteration ?? 0) < 1; i++) {
      vu.step(0.02);
    }

    expect(vp.getCurrentVamp()?.currentIteration).toBe(1);
    // Measure "3" must never appear while still repeating
    expect(measuresShown.filter(m => m === "3")).toHaveLength(0);

    vp.unload();
    await vc.close();
  });

  // ── segue ─────────────────────────────────────────────────────────────────

  it("emits segue when reaching the end with segue enabled", async () => {
    const { player: sp, updater: su, ctx: sc } = makePlayer();
    const segueEmitted = vi.fn();
    sp.onSegue(segueEmitted);

    const song = makeMidiSong();
    song.events.segue = true;
    mockAxios();
    await sp.load(song);

    sp.play();
    stepPast(su, sp, TICKS.duration);

    expect(segueEmitted).toHaveBeenCalledOnce();
    sp.unload();
    await sc.close();
  });
});
