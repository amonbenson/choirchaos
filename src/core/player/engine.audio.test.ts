import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VampVocals } from "@/core/player/types";
import { makeAudioSong, makeAudioSongWithVamp, makeAudioSongWithVampOut, makeAudioSongWithVocalVamp } from "@/test/fixtures";
import { ManualUpdater } from "@/test/updater";

import AudioDriver from "./audio/driver";
import PlayerEngine from "./engine";

vi.mock("axios");
vi.mock("./audio/driver", () => ({ default: { create: vi.fn() } }));
vi.mock("midi-json-parser", () => ({ parseArrayBuffer: vi.fn() }));

// ── helpers ───────────────────────────────────────────────────────────────────

type MockAudioDriver = {
  getPosition: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  scheduleSeek: ReturnType<typeof vi.fn>;
  setGain: ReturnType<typeof vi.fn>;
  setTempo: ReturnType<typeof vi.fn>;
  setPitch: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function makeMockAP(): MockAudioDriver {
  return {
    getPosition: vi.fn().mockReturnValue(0),
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
    scheduleSeek: vi.fn(),
    setGain: vi.fn(),
    setTempo: vi.fn(),
    setPitch: vi.fn(),
    connect: vi.fn(),
    dispose: vi.fn(),
  };
}

function makePlayer(): { player: PlayerEngine; updater: ManualUpdater; ctx: AudioContext } {
  const ctx = new AudioContext();
  let updater!: ManualUpdater;
  const player = new PlayerEngine(ctx, (cb) => {
    updater = new ManualUpdater(cb);
    return updater;
  });
  return { player, updater, ctx };
}

async function loadAudioSong(
  player: PlayerEngine,
  ctx: AudioContext,
  mockAP: MockAudioDriver,
  segue = false,
): Promise<void> {
  const buf = ctx.createBuffer(2, 44100, 44100);
  vi.spyOn(ctx, "decodeAudioData").mockResolvedValue(buf);
  vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
  vi.mocked(AudioDriver.create).mockResolvedValue(mockAP as unknown as AudioDriver);

  const song = makeAudioSong();
  if (segue) {
    song.events.segue = true;
  }

  await player.load(song);
}

async function loadOutSong(
  player: PlayerEngine,
  ctx: AudioContext,
  mockAP: MockAudioDriver,
  out: "onEnd" | "everyBar" | "everyBeat",
): Promise<void> {
  const buf = ctx.createBuffer(2, 44100, 44100);
  vi.spyOn(ctx, "decodeAudioData").mockResolvedValue(buf);
  vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
  vi.mocked(AudioDriver.create).mockResolvedValue(mockAP as unknown as AudioDriver);
  await player.load(makeAudioSongWithVampOut(out));
}

async function loadVocalSong(
  player: PlayerEngine,
  ctx: AudioContext,
  mockAP: MockAudioDriver,
  vocals: VampVocals = "split",
): Promise<void> {
  const buf = ctx.createBuffer(2, 44100, 44100);
  vi.spyOn(ctx, "decodeAudioData").mockResolvedValue(buf);
  vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
  vi.mocked(AudioDriver.create).mockResolvedValue(mockAP as unknown as AudioDriver);
  await player.load(makeAudioSongWithVocalVamp(vocals));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("PlayerEngine – audio mode", () => {
  let player: PlayerEngine;
  let updater: ManualUpdater;
  let ctx: AudioContext;
  let mockAP: MockAudioDriver;

  beforeEach(async () => {
    ({ player, updater, ctx } = makePlayer());
    mockAP = makeMockAP();
    await loadAudioSong(player, ctx, mockAP);
  });

  afterEach(async () => {
    player.unload();
    await ctx.close();
    vi.clearAllMocks();
  });

  // ── status lifecycle ──────────────────────────────────────────────────────

  it("reaches ready status after load in audio mode", () => {
    expect(player.getStatus()).toBe("ready");
    expect(player.getMode()).toBe("audio");
  });

  // ── position tracking ─────────────────────────────────────────────────────

  it("syncs position from audioPlayer.position (seconds → ticks/ms)", () => {
    mockAP.getPosition.mockReturnValue(0.5);
    player.play();
    updater.step(0.02);

    expect(player.getPosition()).toBeCloseTo(500, 0);
  });

  it("advances position as audioPlayer reports later positions", () => {
    player.play();

    mockAP.getPosition.mockReturnValue(0.1);
    updater.step(0.02);
    const p1 = player.getPosition();

    mockAP.getPosition.mockReturnValue(0.3);
    updater.step(0.02);
    const p2 = player.getPosition();

    expect(p2).toBeGreaterThan(p1);
  });

  // ── seek ──────────────────────────────────────────────────────────────────

  it("seek delegates to audioPlayer.seek in seconds", () => {
    player.seek(500);
    expect(mockAP.seek).toHaveBeenCalledWith(0.5);
  });

  // ── gain sync ─────────────────────────────────────────────────────────────

  it("propagates track gain changes to audioPlayer.setGain each step", () => {
    const song = makeAudioSong();
    player.play();
    song.setTrackGain(0, 0.5);

    mockAP.getPosition.mockReturnValue(0);
    updater.step(0.02);

    expect(mockAP.setGain).toHaveBeenCalled();
  });

  // ── stop at end ───────────────────────────────────────────────────────────

  it("pauses when audioPlayer position reaches or exceeds duration", () => {
    player.play();
    mockAP.getPosition.mockReturnValue(1.1); // 1100 ms > 1000 ms duration
    updater.step(0.02);

    expect(player.isPlaying()).toBe(false);
  });

  // ── playback controls ─────────────────────────────────────────────────────

  it("calls audioPlayer.play and pause", () => {
    player.play();
    expect(mockAP.play).toHaveBeenCalledOnce();

    player.pause();
    expect(mockAP.pause).toHaveBeenCalledOnce();
  });

  it("emits segue when end is reached with segue enabled", async () => {
    const { player: sp, updater: su, ctx: sc } = makePlayer();
    const ap = makeMockAP();
    await loadAudioSong(sp, sc, ap, true);

    const segueEmitted = vi.fn();
    sp.onSegue(segueEmitted);

    sp.play();
    ap.getPosition.mockReturnValue(1.1);
    su.step(0.02);

    expect(segueEmitted).toHaveBeenCalledOnce();

    sp.unload();
    await sc.close();
  });

  // ── vamp ─────────────────────────────────────────────────────────────────

  it("calls scheduleSeek (not seek) when crossing a vamp boundary", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();

    // Wire scheduleSeek so the mock driver reports the new position after the jump.
    ap.scheduleSeek.mockImplementation((pos: number) => {
      ap.getPosition.mockReturnValue(pos);
    });

    const buf = vc.createBuffer(2, 44100, 44100);
    vi.spyOn(vc, "decodeAudioData").mockResolvedValue(buf);
    vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
    vi.mocked(AudioDriver.create).mockResolvedValue(ap as unknown as AudioDriver);

    await vp.load(makeAudioSongWithVamp());
    // Clear calls from load() (initial seek to 0) so assertions below are unambiguous.
    ap.seek.mockClear();
    ap.scheduleSeek.mockClear();

    vp.play();

    // First step: driver reports 300 ms — inside the vamp region [250 ms, 500 ms).
    // The engine stores this as the new position; vamp entry is detected at the
    // START of the next step (not the end of this one).
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    // Second step: driver reports 500 ms — at the vamp end. The engine detects vamp
    // entry (pos=300 is in range), applies the limit, then triggers the jump.
    ap.getPosition.mockReturnValue(0.5);
    vu.step(0.02);

    // scheduleSeek must have been called with the vamp-start position (250 ms = 0.25 s)
    // and lookahead=0 so the audio switches immediately (no 100ms overshoot past the boundary).
    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);
    // Hard seek must NOT have been called for the vamp jump.
    expect(ap.seek).not.toHaveBeenCalled();
    // Engine position should be back near the vamp start.
    expect(vp.getPosition()).toBeLessThan(500);

    vp.unload();
    await vc.close();
  });

  // ── vamp phases ───────────────────────────────────────────────────────────

  // Fixture: 2 tracks (Accompaniment index 0, Vocal index 1), vamp at 250–500 ms,
  // 2 iterations → last pass is currentIteration >= 2, midpoint = 375 ms.
  // Phase boundaries tested below via setGain spy.

  it("does not mute vocals during entering phase (iteration 0, first half)", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadVocalSong(vp, vc, ap);
    ap.seek.mockClear();

    vp.play();
    // Step 1: pos advances into vamp region (250–500 ms); vamp entry detected next step.
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    // Step 2: vamp entered at pos=300 ms (< midpoint 375 ms) → entering phase.
    ap.getPosition.mockReturnValue(0.3);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).not.toHaveBeenCalledWith(1, 0); // vocal not muted
    expect(ap.setGain).toHaveBeenCalledWith(0, 1); // accompaniment plays

    vp.unload();
    await vc.close();
  });

  it("mutes vocals during repeating phase (iteration 0, second half)", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadVocalSong(vp, vc, ap);
    ap.seek.mockClear();

    vp.play();
    // Step 1: pos advances past midpoint (400 ms > 375 ms) without entering the vamp yet.
    ap.getPosition.mockReturnValue(0.4);
    vu.step(0.02);
    // Step 2: vamp entered at pos=400 ms (>= midpoint 375 ms, iteration 0) → repeating phase.
    ap.getPosition.mockReturnValue(0.4);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).toHaveBeenCalledWith(1, 0); // vocal muted
    expect(ap.setGain).toHaveBeenCalledWith(0, 1); // accompaniment plays

    vp.unload();
    await vc.close();
  });

  it("does not mute vocals during exiting phase triggered by manualExit", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadVocalSong(vp, vc, ap);
    ap.seek.mockClear();

    vp.play();
    // Enter vamp.
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.4);
    vu.step(0.02);

    vp.exitVamp();

    ap.getPosition.mockReturnValue(0.4);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).not.toHaveBeenCalledWith(1, 0); // vocal not muted
    expect(ap.setGain).toHaveBeenCalledWith(0, 1); // accompaniment plays

    vp.unload();
    await vc.close();
  });

  it("does not mute vocals during exiting phase (last iteration, second half)", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    ap.scheduleSeek.mockImplementation((pos: number) => {
      ap.getPosition.mockReturnValue(pos);
    });
    await loadVocalSong(vp, vc, ap);
    ap.seek.mockClear();
    ap.scheduleSeek.mockClear();

    vp.play();
    // Step 1: advance into vamp region.
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    // Steps 2–3: trigger two vamp loops to reach the last pass (currentIteration = 2).
    ap.getPosition.mockReturnValue(0.5);
    vu.step(0.02); // loop → iter 1
    ap.getPosition.mockReturnValue(0.5);
    vu.step(0.02); // loop → iter 2
    // Step 4: last pass; driver at 400 ms advances pos past the midpoint (375 ms).
    ap.getPosition.mockReturnValue(0.4);
    vu.step(0.02);
    // Step 5: pos=400 ms, last pass, second half (>= midpoint) → exiting phase.
    ap.getPosition.mockReturnValue(0.4);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).not.toHaveBeenCalledWith(1, 0); // vocal not muted
    expect(ap.setGain).toHaveBeenCalledWith(0, 1); // accompaniment plays

    vp.unload();
    await vc.close();
  });

  it("scheduleSeek uses exact vamp start even when getPosition overshoots the boundary", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    ap.scheduleSeek.mockImplementation((pos: number) => {
      ap.getPosition.mockReturnValue(pos);
    });

    const buf = vc.createBuffer(2, 44100, 44100);
    vi.spyOn(vc, "decodeAudioData").mockResolvedValue(buf);
    vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
    vi.mocked(AudioDriver.create).mockResolvedValue(ap as unknown as AudioDriver);
    await vp.load(makeAudioSongWithVamp());
    ap.seek.mockClear();
    ap.scheduleSeek.mockClear();

    vp.play();

    // Enter vamp region.
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    // Overshoot vamp end by 10 ms (0.51 instead of 0.50). The limit-clamping in step()
    // ensures the jump target is still exactly 0.25 (= vamp start), not 0.26.
    ap.getPosition.mockReturnValue(0.51);
    vu.step(0.02);

    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);

    vp.unload();
    await vc.close();
  });

  it("syncWarp re-resolves vamp boundaries so the engine keeps looping at the new positions", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    ap.scheduleSeek.mockImplementation((pos: number) => {
      ap.getPosition.mockReturnValue(pos);
    });

    const buf = vc.createBuffer(2, 44100, 44100);
    vi.spyOn(vc, "decodeAudioData").mockResolvedValue(buf);
    vi.mocked(axios.get).mockResolvedValue({ data: new ArrayBuffer(8) });
    vi.mocked(AudioDriver.create).mockResolvedValue(ap as unknown as AudioDriver);
    await vp.load(makeAudioSongWithVamp());
    ap.seek.mockClear();
    ap.scheduleSeek.mockClear();

    // syncWarp must complete without error (re-resolves ticks, updates display state).
    expect(() => vp.syncWarp()).not.toThrow();
    expect(vp.getStatus()).toBe("ready");

    // After syncWarp the vamp is still functional — trigger it to confirm.
    vp.play();
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.5);
    vu.step(0.02);

    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25, 0);

    vp.unload();
    await vc.close();
  });

  // ── vamp out ──────────────────────────────────────────────────────────────
  // Fixture: 4 measures at 0.25 s each, infinite vamp from measure "2" (250 ms) to "4" (750 ms).
  // Barline inside vamp: measure "3" at 500 ms.  Beat ticks (4/measure): 250, 312.5, 375, 437.5, 500, … ms.
  // All tests enter the vamp at 300 ms, call exitVamp(), then assert on when/where the exit fires.

  it("onEnd: manual exit plays through the barline and exits only at the vamp end", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadOutSong(vp, vc, ap, "onEnd");
    vp.play();

    // Enter vamp region, then enter vamp.
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    vp.exitVamp();
    ap.scheduleSeek.mockClear();

    // Position at barline (500 ms) — onEnd must NOT exit here.
    ap.getPosition.mockReturnValue(0.5);
    vu.step(0.02);
    expect(ap.scheduleSeek).not.toHaveBeenCalled();
    expect(vp.getCurrentVamp()).not.toBeUndefined();

    // Position at vamp end (750 ms) — exits without a jump.
    ap.getPosition.mockReturnValue(0.75);
    vu.step(0.02);
    expect(ap.scheduleSeek).not.toHaveBeenCalled();
    expect(vp.getCurrentVamp()).toBeUndefined();

    vp.unload();
    await vc.close();
  });

  it("everyBar: manual exit jumps to vamp end at the next barline", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    ap.scheduleSeek.mockImplementation((pos: number) => {
      ap.getPosition.mockReturnValue(pos);
    });
    await loadOutSong(vp, vc, ap, "everyBar");
    vp.play();

    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    vp.exitVamp();
    ap.scheduleSeek.mockClear();

    // Overshoot the barline at 500 ms — everyBar exits there and jumps to vamp end (750 ms).
    ap.getPosition.mockReturnValue(0.52);
    vu.step(0.02);
    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.75, 0);
    expect(vp.getCurrentVamp()).toBeUndefined();

    vp.unload();
    await vc.close();
  });

  // ── vamp vocals ───────────────────────────────────────────────────────────
  // Fixture: 2 tracks (Accompaniment 0, Vocal 1), vamp at 250–500 ms, 2 iterations,
  // midpoint = 375 ms. Steps enter the vamp in the relevant phase before asserting setGain.

  it("vocals=\"every\": never mutes vocals during repeating phase", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadVocalSong(vp, vc, ap, "every");
    vp.play();

    // Enter vamp region; vamp detected at next step.
    ap.getPosition.mockReturnValue(0.4); // past midpoint (0.375) → would be repeating
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.4);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).not.toHaveBeenCalledWith(1, 0);

    vp.unload();
    await vc.close();
  });

  it("vocals=\"first\": mutes vocals during exiting phase", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadVocalSong(vp, vc, ap, "first");
    vp.play();

    // Enter vamp in entering phase (< midpoint).
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    vp.exitVamp(); // → exiting phase

    ap.getPosition.mockReturnValue(0.3);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).toHaveBeenCalledWith(1, 0); // vocal muted during exiting

    vp.unload();
    await vc.close();
  });

  it("vocals=\"last\": mutes vocals during entering phase", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    await loadVocalSong(vp, vc, ap, "last");
    vp.play();

    // Enter vamp in entering phase (pos=300 < midpoint=375).
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.3);
    ap.setGain.mockClear();
    vu.step(0.02);

    expect(ap.setGain).toHaveBeenCalledWith(1, 0); // vocal muted during entering

    vp.unload();
    await vc.close();
  });

  it("everyBeat: manual exit jumps to vamp end at the next beat", async () => {
    const { player: vp, updater: vu, ctx: vc } = makePlayer();
    const ap = makeMockAP();
    ap.scheduleSeek.mockImplementation((pos: number) => {
      ap.getPosition.mockReturnValue(pos);
    });
    await loadOutSong(vp, vc, ap, "everyBeat");
    vp.play();

    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);
    ap.getPosition.mockReturnValue(0.3);
    vu.step(0.02);

    vp.exitVamp();
    ap.scheduleSeek.mockClear();

    // Overshoot the next beat at 312.5 ms — everyBeat exits there and jumps to vamp end (750 ms).
    ap.getPosition.mockReturnValue(0.32);
    vu.step(0.02);
    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.75, 0);
    expect(vp.getCurrentVamp()).toBeUndefined();

    vp.unload();
    await vc.close();
  });
});
