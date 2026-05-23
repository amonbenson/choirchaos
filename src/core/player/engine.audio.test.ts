import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeAudioSong } from "@/test/fixtures";
import { ManualUpdater } from "@/test/updater";

import AudioDriver from "./audio/driver";
import PlayerEngine from "./engine";

vi.mock("axios");
vi.mock("./audio/driver", () => ({ default: { create: vi.fn() } }));
vi.mock("midi-json-parser", () => ({ parseArrayBuffer: vi.fn() }));

// ── helpers ───────────────────────────────────────────────────────────────────

type MockAudioDriver = {
  position: number;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  setGain: ReturnType<typeof vi.fn>;
  setTempo: ReturnType<typeof vi.fn>;
  setPitch: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function makeMockAP(): MockAudioDriver {
  return {
    position: 0,
    play: vi.fn(),
    pause: vi.fn(),
    seek: vi.fn(),
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
    expect(player.status).toBe("ready");
    expect(player.mode).toBe("audio");
  });

  // ── position tracking ─────────────────────────────────────────────────────

  it("syncs position from audioPlayer.position (seconds → ticks/ms)", () => {
    mockAP.position = 0.5;
    player.play();
    updater.step(0.02);

    expect(player.position).toBeCloseTo(500, 0);
  });

  it("advances position as audioPlayer reports later positions", () => {
    player.play();

    mockAP.position = 0.1;
    updater.step(0.02);
    const p1 = player.position;

    mockAP.position = 0.3;
    updater.step(0.02);
    const p2 = player.position;

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

    mockAP.position = 0;
    updater.step(0.02);

    expect(mockAP.setGain).toHaveBeenCalled();
  });

  // ── stop at end ───────────────────────────────────────────────────────────

  it("pauses when audioPlayer position reaches or exceeds duration", () => {
    player.play();
    mockAP.position = 1.1; // 1100 ms > 1000 ms duration
    updater.step(0.02);

    expect(player.playing).toBe(false);
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
    sp.on("segue", segueEmitted);

    sp.play();
    ap.position = 1.1;
    su.step(0.02);

    expect(segueEmitted).toHaveBeenCalledOnce();

    sp.unload();
    await sc.close();
  });
});
