import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAudioSong, makeAudioSongWithVamp } from "@/test/fixtures";
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

    // scheduleSeek must have been called with the vamp-start position (250 ms = 0.25 s).
    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25);
    // Hard seek must NOT have been called for the vamp jump.
    expect(ap.seek).not.toHaveBeenCalled();
    // Engine position should be back near the vamp start.
    expect(vp.getPosition()).toBeLessThan(500);

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

    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25);

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

    expect(ap.scheduleSeek).toHaveBeenCalledWith(0.25);

    vp.unload();
    await vc.close();
  });
});
