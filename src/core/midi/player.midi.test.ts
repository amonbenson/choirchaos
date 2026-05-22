import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeMidiBuffer, makeMidiSong, makeMidiSongWithVamp, makeMtiJson, TICKS, TRACK_NAMES } from "@/test/fixtures";
import { ManualUpdater } from "@/test/updater";

import type { NoteEvent } from "./events";
import MidiPlayer from "./player";

vi.mock("axios");

// rubberband-web imports tone (broken ESM, extensionless imports) which fails in Node.
// Replace with a plain GainNode passthrough — same mock used in audioPlayer.test.ts.
vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));

// Replace midi-json-parser (uses Web Workers, unavailable in jsdom/node) with a
// synchronous mock that returns the event structure our fixture MIDI_TRACKS produces.
vi.mock("midi-json-parser", () => ({
  parseArrayBuffer: vi.fn().mockResolvedValue({
    tracks: [
      // track 0: empty tempo track
      [],
      // track 1: Instrument  – notes from MIDI_TRACKS[0]
      [
        { delta: 0, trackName: TRACK_NAMES.instrument },
        { delta: 480, noteOn: { noteNumber: 60, velocity: 80 } }, // C4 @ tick 480
        { delta: 240, noteOff: { noteNumber: 60, velocity: 0 } }, // end @ tick 720
        { delta: 1680, noteOn: { noteNumber: 64, velocity: 80 } }, // E4 @ tick 2400
        { delta: 240, noteOff: { noteNumber: 64, velocity: 0 } }, // end @ tick 2640
      ],
      // track 2: Vocals  – notes from MIDI_TRACKS[1]
      [
        { delta: 0, trackName: TRACK_NAMES.vocals },
        { delta: 4320, noteOn: { noteNumber: 67, velocity: 80 } }, // G4 @ tick 4320
        { delta: 480, noteOff: { noteNumber: 67, velocity: 0 } }, // end @ tick 4800
        { delta: 480, noteOn: { noteNumber: 69, velocity: 80 } }, // A4 @ tick 5280
        { delta: 480, noteOff: { noteNumber: 69, velocity: 0 } }, // end @ tick 5760
      ],
    ],
  }),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function makePlayer(): { player: MidiPlayer; updater: ManualUpdater; ctx: AudioContext } {
  const ctx = new AudioContext();
  let updater!: ManualUpdater;
  const player = new MidiPlayer(ctx, (cb) => {
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

// Advance in 20 ms steps until player.position exceeds targetTick or player stops.
// Takes one extra flush step after overshooting so that end-of-segment logic (pause,
// segue) fires — the player checks position >= duration at the START of each step.
function stepPast(updater: ManualUpdater, player: MidiPlayer, targetTick: number): void {
  for (let i = 0; i < 10_000; i++) {
    if (player.position > targetTick) {
      break;
    }

    if (!updater.running) {
      break;
    }

    updater.step(0.02);
  }

  if (updater.running) {
    updater.step(0.02);
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("MidiPlayer – MIDI mode", () => {
  let player: MidiPlayer;
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
    expect(player.status).toBe("ready");
  });

  it("returns to idle after unload", () => {
    player.unload();
    expect(player.status).toBe("idle");
  });

  it("emits statusChanged events during load", async () => {
    const { player: p2, ctx: ctx2 } = makePlayer();
    const statuses: string[] = [];
    p2.on("statusChanged", s => statuses.push(s as string));

    mockAxios();
    await p2.load(makeMidiSong());

    expect(statuses).toEqual(["loading", "ready"]);

    p2.unload();
    await ctx2.close();
  });

  // ── seek ──────────────────────────────────────────────────────────────────

  it("seek to measure 2 sets currentMeasure to ['2', 0]", () => {
    player.seek(TICKS.measure2);
    expect(player.currentMeasure).toEqual(["2", 0]);
  });

  it("seek past the tempo change sets currentTempo to 140", () => {
    player.seek(TICKS.measure3 + 1);
    expect(player.currentTempo).toBe(140);
  });

  it("stop resets position to 0", () => {
    player.seek(TICKS.measure2);
    player.stop();
    expect(player.position).toBe(0);
  });

  // ── duration ─────────────────────────────────────────────────────────────

  it("duration equals last-measure start + tickLength (8160)", () => {
    expect(player.duration).toBe(TICKS.duration);
  });

  // ── note events ───────────────────────────────────────────────────────────

  it("emits note events for instrument track when stepping past tick 480", () => {
    const notes: NoteEvent[] = [];
    player.on("note", e => notes.push(e as NoteEvent));

    player.play();
    stepPast(updater, player, TICKS.measure1 + 10);

    const instrumentNotes = notes.filter(n => n.trackIndex === 0);
    expect(instrumentNotes.length).toBeGreaterThan(0);
    expect(instrumentNotes[0]!.pitch).toBe(60);
  });

  it("emits note events for vocals track when stepping past tick 4320", () => {
    const notes: NoteEvent[] = [];
    player.on("note", e => notes.push(e as NoteEvent));

    player.play();
    stepPast(updater, player, TICKS.measure3 + 10);

    const vocalNotes = notes.filter(n => n.trackIndex === 1);
    expect(vocalNotes.length).toBeGreaterThan(0);
    expect(vocalNotes[0]!.pitch).toBe(67);
  });

  it("does not emit note events during seek (only during play)", () => {
    const notes: NoteEvent[] = [];
    player.on("note", e => notes.push(e as NoteEvent));
    player.seek(TICKS.measure2);
    expect(notes).toHaveLength(0);
  });

  // ── tempo change ──────────────────────────────────────────────────────────

  it("updates currentTempo when a TEMPO event is stepped through", () => {
    expect(player.currentTempo).toBe(120);
    player.play();
    stepPast(updater, player, TICKS.measure3 + 10);
    expect(player.currentTempo).toBe(140);
  });

  // ── playback controls ─────────────────────────────────────────────────────

  it("emits playingChanged true on play and false on pause", () => {
    const events: boolean[] = [];
    player.on("playingChanged", v => events.push(v as boolean));
    player.play();
    player.pause();
    expect(events).toEqual([true, false]);
  });

  it("position does not advance while paused", () => {
    player.play();
    stepPast(updater, player, TICKS.measure1);
    player.pause();
    const posAfterPause = player.position;
    updater.step(0.1); // updater is stopped; step is a no-op
    expect(player.position).toBe(posAfterPause);
  });

  it("auto-pauses and clamps position at duration when end is reached", () => {
    player.play();
    stepPast(updater, player, TICKS.duration);
    expect(player.playing).toBe(false);
    expect(player.position).toBe(TICKS.duration);
  });

  // ── vamp ─────────────────────────────────────────────────────────────────

  it("enters a vamp when position first crosses its start tick", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    vp.play();
    stepPast(vu, vp, TICKS.measure2 + 10);

    expect(vp.currentVamp).toBeDefined();
    vp.unload();
    await vc.close();
  });

  it("wraps position back after crossing vamp end (first loop)", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp());

    vp.play();
    // Step until the vamp's iteration counter increments (one full loop completed)
    for (let i = 0; i < 10_000 && (vp.currentVamp?.currentIteration ?? 0) === 0; i++) {
      vu.step(0.02);
    }

    expect(vp.currentVamp).toBeDefined();
    expect(vp.currentVamp!.currentIteration).toBeGreaterThan(0);
    expect(vp.position).toBeLessThan(TICKS.measure3);

    vp.unload();
    await vc.close();
  });

  it("exits vamp after reaching max iterations", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    mockAxios();
    await vp.load(makeMidiSongWithVamp()); // 2 iterations

    vp.play();
    // Phase 1: advance until the vamp is entered (currentVamp starts as undefined).
    for (let i = 0; i < 10_000 && vp.currentVamp === undefined; i++) {
      vu.step(0.02);
    }

    // Phase 2: keep going until the vamp exits after max iterations.
    for (let i = 0; i < 10_000 && vp.currentVamp !== undefined; i++) {
      vu.step(0.02);
    }

    expect(vp.currentVamp).toBeUndefined();
    expect(vp.position).toBeGreaterThanOrEqual(TICKS.measure3);

    vp.unload();
    await vc.close();
  });

  // ── segue ─────────────────────────────────────────────────────────────────

  it("emits segue when reaching the end with segue enabled", async () => {
    const { player: sp, updater: su, ctx: sc } = makePlayer();
    const segueEmitted = vi.fn();
    sp.on("segue", segueEmitted);

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
