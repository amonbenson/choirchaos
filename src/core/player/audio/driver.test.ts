import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeRms, makeSineBuffer } from "@/test/fixtures";

import AudioDriver from "./driver";

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

describe("AudioDriver", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  afterEach(async () => {
    await ctx.close();
    vi.clearAllMocks();
  });

  // ── factory ───────────────────────────────────────────────────────────────

  it("create() resolves to an AudioDriver instance", async () => {
    const buf = makeSilentBuffer(ctx);
    const driver = await AudioDriver.create(ctx, [buf], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(driver).toBeDefined();
    driver.dispose();
  });

  // ── position tracking ─────────────────────────────────────────────────────

  it("position starts at 0 before play", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(driver.getPosition()).toBe(0);
    driver.dispose();
  });

  it("seek updates position when not playing", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    driver.seek(0.5);
    expect(driver.getPosition()).toBe(0.5);
    driver.dispose();
  });

  it("seek and play resume from the seeked position", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    driver.seek(0.3);
    driver.play();
    // position should advance from 0.3, not from 0
    expect(driver.getPosition()).toBeGreaterThanOrEqual(0.3);
    driver.pause();
    driver.dispose();
  });

  // ── gain ──────────────────────────────────────────────────────────────────

  it("setGain does not throw and accepts values in [0, 1]", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => driver.setGain(0, 0)).not.toThrow();
    expect(() => driver.setGain(0, 0.5)).not.toThrow();
    expect(() => driver.setGain(0, 1.0)).not.toThrow();
    driver.dispose();
  });

  // ── tempo / pitch ─────────────────────────────────────────────────────────

  it("setTempo does not throw", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => driver.setTempo(1.2)).not.toThrow();
    driver.dispose();
  });

  it("setPitch does not throw", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => driver.setPitch(2)).not.toThrow();
    driver.dispose();
  });

  // ── audio output analysis via OfflineAudioContext ─────────────────────────

  it("passes audio signal through to the output (non-zero RMS)", async () => {
    // Render 1 second of a 440 Hz sine wave through the full AudioDriver chain.
    // The rubberband node is mocked as a plain GainNode, so audio passes through.
    const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const sineBuf = makeSineBuffer(offlineCtx, 440, 1.0);

    const driver = await AudioDriver.create(offlineCtx as unknown as AudioContext, [sineBuf], {
      tracks: [{ highPassFilter: false, compressor: false }],
      onAmplitudes: () => {},
    });
    driver.connect(offlineCtx.destination);
    driver.play();

    const rendered = await offlineCtx.startRendering();
    const rms = computeRms(rendered.getChannelData(0));

    expect(rms).toBeGreaterThan(0.1);
    driver.dispose();
  });

  it("muted track (gain=0) produces near-silent output", async () => {
    const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const sineBuf = makeSineBuffer(offlineCtx, 440, 1.0);

    const driver = await AudioDriver.create(offlineCtx as unknown as AudioContext, [sineBuf], {
      tracks: [{ highPassFilter: false, compressor: false }],
      onAmplitudes: () => {},
    });
    driver.setGain(0, 0);
    driver.connect(offlineCtx.destination);
    driver.play();

    const rendered = await offlineCtx.startRendering();
    const rms = computeRms(rendered.getChannelData(0));

    // setTargetAtTime with gain=0 approaches but may not reach exact zero; use a loose bound
    expect(rms).toBeLessThan(0.05);
    driver.dispose();
  });

  // ── scheduleSeek ──────────────────────────────────────────────────────────

  it("scheduleSeek while not playing updates position immediately", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    driver.scheduleSeek(0.7);
    expect(driver.getPosition()).toBe(0.7);
    driver.dispose();
  });

  it("scheduleSeek while playing reports new position immediately", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    driver.play();
    driver.scheduleSeek(0.4);
    // During the lookahead window getPosition() returns the new refPosition
    expect(driver.getPosition()).toBe(0.4);
    driver.pause();
    driver.dispose();
  });

  // ── dispose ───────────────────────────────────────────────────────────────

  it("dispose clears the amplitude interval without throwing", async () => {
    const driver = await AudioDriver.create(ctx, [makeSilentBuffer(ctx)], {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    expect(() => driver.dispose()).not.toThrow();
  });
});
