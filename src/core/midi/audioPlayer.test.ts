import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeRms, makeSineBuffer } from "@/test/fixtures";

import AudioPlayer from "./audioPlayer";

// Mock rubberband-web: replace createRubberBandNode with a plain GainNode passthrough.
// The RubberBandNode interface is satisfied by adding stub methods for setPitch and close.
vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));

const SAMPLE_RATE = 44100;

function makeSilentBuffer(ctx: BaseAudioContext, seconds = 1): AudioBuffer {
  return ctx.createBuffer(2, Math.floor(SAMPLE_RATE * seconds), SAMPLE_RATE);
}

describe("AudioPlayer", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  afterEach(async () => {
    await ctx.close();
    vi.clearAllMocks();
  });

  // ── factory ───────────────────────────────────────────────────────────────

  it("create() resolves to an AudioPlayer instance", async () => {
    const buf = makeSilentBuffer(ctx);
    const player = await AudioPlayer.create(ctx, [buf], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(player).toBeDefined();
    player.dispose();
  });

  // ── position tracking ─────────────────────────────────────────────────────

  it("position starts at 0 before play", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(player.position).toBe(0);
    player.dispose();
  });

  it("seek updates position when not playing", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    player.seek(0.5);
    expect(player.position).toBe(0.5);
    player.dispose();
  });

  it("seek and play resume from the seeked position", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    player.seek(0.3);
    player.play();
    // position should advance from 0.3, not from 0
    expect(player.position).toBeGreaterThanOrEqual(0.3);
    player.pause();
    player.dispose();
  });

  // ── gain ──────────────────────────────────────────────────────────────────

  it("setGain does not throw and accepts values in [0, 1]", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => player.setGain(0, 0)).not.toThrow();
    expect(() => player.setGain(0, 0.5)).not.toThrow();
    expect(() => player.setGain(0, 1.0)).not.toThrow();
    player.dispose();
  });

  // ── tempo / pitch ─────────────────────────────────────────────────────────

  it("setTempo does not throw", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => player.setTempo(1.2)).not.toThrow();
    player.dispose();
  });

  it("setPitch does not throw", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => player.setPitch(2)).not.toThrow();
    player.dispose();
  });

  // ── audio output analysis via OfflineAudioContext ─────────────────────────

  it("passes audio signal through to the output (non-zero RMS)", async () => {
    // Render 1 second of a 440 Hz sine wave through the full AudioPlayer chain.
    // The rubberband node is mocked as a plain GainNode, so audio passes through.
    const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const sineBuf = makeSineBuffer(offlineCtx, 440, 1.0);

    const player = await AudioPlayer.create(offlineCtx as unknown as AudioContext, [sineBuf], {
      tracks: [{ highPassFilter: false, compressor: false }],
      onAmplitudes: () => {},
    });
    player.connect(offlineCtx.destination);
    player.play();

    const rendered = await offlineCtx.startRendering();
    const rms = computeRms(rendered.getChannelData(0));

    expect(rms).toBeGreaterThan(0.1);
    player.dispose();
  });

  it("muted track (gain=0) produces near-silent output", async () => {
    const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const sineBuf = makeSineBuffer(offlineCtx, 440, 1.0);

    const player = await AudioPlayer.create(offlineCtx as unknown as AudioContext, [sineBuf], {
      tracks: [{ highPassFilter: false, compressor: false }],
      onAmplitudes: () => {},
    });
    player.setGain(0, 0);
    player.connect(offlineCtx.destination);
    player.play();

    const rendered = await offlineCtx.startRendering();
    const rms = computeRms(rendered.getChannelData(0));

    // setTargetAtTime with gain=0 approaches but may not reach exact zero; use a loose bound
    expect(rms).toBeLessThan(0.05);
    player.dispose();
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  it("dispose clears the amplitude interval without throwing", async () => {
    const player = await AudioPlayer.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => player.dispose()).not.toThrow();
  });
});
