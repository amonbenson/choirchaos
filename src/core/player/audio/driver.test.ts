/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { computeRms } from "@/test/fixtures";

import { type AudioChunk, detectChunks } from "./chunkDetector";
import AudioDriver from "./driver";

vi.mock("rubberband-web", () => ({
  createRubberBandNode: vi.fn().mockImplementation(async (ctx: AudioContext) => {
    const node = ctx.createGain();
    (node as any).setPitch = vi.fn();
    (node as any).close = vi.fn();
    return node;
  }),
}));

const SAMPLE_RATE = 44100;
const DATA_DIR = resolve(process.cwd(), "src/test/data");

function makeBuffer(
  ctx: BaseAudioContext,
  sections: Array<{ silent: boolean; durationSec: number }>,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const totalSamples = sections.reduce((acc, s) => acc + Math.floor(sr * s.durationSec), 0);
  const buf = ctx.createBuffer(2, totalSamples, sr);
  const ch0 = buf.getChannelData(0);
  const ch1 = buf.getChannelData(1);
  let offset = 0;
  for (const s of sections) {
    const len = Math.floor(sr * s.durationSec);
    if (!s.silent) {
      for (let i = 0; i < len; i++) {
        ch0[offset + i] = 0.5;
        ch1[offset + i] = 0.5;
      }
    }

    offset += len;
  }

  return buf;
}

function makeMonoChunk(ctx: BaseAudioContext, sampleOffset: number, durationSec: number): AudioChunk {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * durationSec);
  const buf = ctx.createBuffer(1, length, sr);
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  }

  return { sampleOffset, audioBuffer: buf };
}

async function decodeMp3(filename: string): Promise<{ buffer: AudioBuffer; ctx: AudioContext }> {
  const raw = readFileSync(`${DATA_DIR}/${filename}`);
  const arrayBuf = new ArrayBuffer(raw.byteLength);
  new Uint8Array(arrayBuf).set(raw);
  const ctx = new AudioContext();
  const buffer = await ctx.decodeAudioData(arrayBuf);
  return { buffer, ctx };
}

// ── detectChunks ─────────────────────────────────────────────────────────────

describe("detectChunks", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  afterEach(async () => {
    await ctx.close();
    vi.clearAllMocks();
  });

  it("returns empty array for a fully silent buffer", () => {
    const buf = ctx.createBuffer(2, SAMPLE_RATE, SAMPLE_RATE);
    expect(detectChunks(buf, ctx)).toHaveLength(0);
  });

  it("returns one chunk for a fully non-silent buffer", () => {
    const buf = makeBuffer(ctx, [{ silent: false, durationSec: 2 }]);
    const chunks = detectChunks(buf, ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sampleOffset).toBe(0);
    expect(chunks[0]!.audioBuffer.numberOfChannels).toBe(1);
  });

  it("splits a buffer with a long gap into two chunks", () => {
    const buf = makeBuffer(ctx, [
      { silent: false, durationSec: 1 },
      { silent: true, durationSec: 2 },
      { silent: false, durationSec: 1 },
    ]);
    const chunks = detectChunks(buf, ctx);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.sampleOffset).toBe(0);
    expect(chunks[1]!.sampleOffset).toBeGreaterThan(SAMPLE_RATE * 0.9);
  });

  it("merges two non-silent regions separated by a gap shorter than minSilenceSeconds", () => {
    const buf = makeBuffer(ctx, [
      { silent: false, durationSec: 1 },
      { silent: true, durationSec: 0.1 },
      { silent: false, durationSec: 1 },
    ]);
    const chunks = detectChunks(buf, ctx);
    expect(chunks).toHaveLength(1);
  });

  it("handles leading silence by starting the first chunk after the gap", () => {
    const buf = makeBuffer(ctx, [
      { silent: true, durationSec: 1 },
      { silent: false, durationSec: 1 },
    ]);
    const chunks = detectChunks(buf, ctx);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.sampleOffset).toBeGreaterThan(SAMPLE_RATE * 0.9);
  });

  it("handles trailing silence by ending the last chunk before it", () => {
    const buf = makeBuffer(ctx, [
      { silent: false, durationSec: 1 },
      { silent: true, durationSec: 1 },
    ]);
    const chunks = detectChunks(buf, ctx);
    expect(chunks).toHaveLength(1);
    const chunkEnd = chunks[0]!.sampleOffset + chunks[0]!.audioBuffer.length;
    expect(chunkEnd).toBeLessThan(buf.length * 0.9);
  });

  it("detects three chunks from a buffer with two long gaps", () => {
    const buf = makeBuffer(ctx, [
      { silent: false, durationSec: 0.5 },
      { silent: true, durationSec: 1 },
      { silent: false, durationSec: 0.5 },
      { silent: true, durationSec: 1 },
      { silent: false, durationSec: 0.5 },
    ]);
    expect(detectChunks(buf, ctx)).toHaveLength(3);
  });

  it("produces mono output buffers regardless of source channel count", () => {
    const buf = makeBuffer(ctx, [{ silent: false, durationSec: 1 }]);
    expect(buf.numberOfChannels).toBe(2);
    const chunks = detectChunks(buf, ctx);
    expect(chunks[0]!.audioBuffer.numberOfChannels).toBe(1);
  });

  it("chunk sampleOffsets and durations are consistent with original buffer", () => {
    const buf = makeBuffer(ctx, [
      { silent: false, durationSec: 1 },
      { silent: true, durationSec: 2 },
      { silent: false, durationSec: 1 },
    ]);
    const chunks = detectChunks(buf, ctx);
    for (const chunk of chunks) {
      const end = chunk.sampleOffset + chunk.audioBuffer.length;
      expect(end).toBeLessThanOrEqual(buf.length);
    }
  });

  // ── real MP3 files ──────────────────────────────────────────────────────────

  it(
    "vocal track: produces multiple chunks covering substantially less than the full duration",
    async () => {
      const { buffer, ctx: mp3Ctx } = await decodeMp3("vocal_example.mp3");
      const chunks = detectChunks(buffer, mp3Ctx);
      await mp3Ctx.close();

      expect(chunks.length).toBeGreaterThanOrEqual(5);
      expect(chunks.every(c => c.audioBuffer.numberOfChannels === 1)).toBe(true);

      const totalChunkSamples = chunks.reduce((sum, c) => sum + c.audioBuffer.length, 0);
      expect(totalChunkSamples / buffer.length).toBeLessThan(0.65);
    },
    60_000,
  );

  it(
    "accomp track: produces at most two chunks covering nearly all of the duration",
    async () => {
      const { buffer, ctx: mp3Ctx } = await decodeMp3("accomp_example.mp3");
      const chunks = detectChunks(buffer, mp3Ctx);
      await mp3Ctx.close();

      expect(chunks.length).toBeLessThanOrEqual(2);
      expect(chunks.every(c => c.audioBuffer.numberOfChannels === 1)).toBe(true);

      const totalChunkSamples = chunks.reduce((sum, c) => sum + c.audioBuffer.length, 0);
      expect(totalChunkSamples / buffer.length).toBeGreaterThan(0.95);
    },
    60_000,
  );
});

// ── AudioDriver ───────────────────────────────────────────────────────────────

describe("AudioDriver", () => {
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
  });

  afterEach(async () => {
    await ctx.close();
    vi.clearAllMocks();
  });

  function makeChunks(offsets: number[] = [0]): AudioChunk[] {
    return offsets.map(o => makeMonoChunk(ctx, o, 1));
  }

  async function makePlayer(chunks: AudioChunk[][] = [makeChunks()]): Promise<AudioDriver> {
    return AudioDriver.create(ctx, chunks, {
      tracks: chunks.map(() => ({})),
      onAmplitudes: () => {},
    });
  }

  // ── factory ─────────────────────────────────────────────────────────────────

  it("create() resolves to an AudioDriver instance", async () => {
    const player = await makePlayer();
    expect(player).toBeDefined();
    player.dispose();
  });

  // ── position tracking ────────────────────────────────────────────────────────

  it("getPosition() starts at 0 before play", async () => {
    const player = await makePlayer();
    expect(player.getPosition()).toBe(0);
    player.dispose();
  });

  it("seek updates position when not playing", async () => {
    const player = await makePlayer();
    player.seek(0.5);
    expect(player.getPosition()).toBe(0.5);
    player.dispose();
  });

  it("seek and play resume from the seeked position", async () => {
    const player = await makePlayer();
    player.seek(0.3);
    player.play();
    expect(player.getPosition()).toBeGreaterThanOrEqual(0.3);
    player.pause();
    player.dispose();
  });

  it("pause snapshots the current position", async () => {
    const player = await makePlayer();
    player.seek(0.4);
    player.play();
    player.pause();
    expect(player.getPosition()).toBeCloseTo(0.4, 1);
    player.dispose();
  });

  // ── gain ─────────────────────────────────────────────────────────────────────

  it("setGain accepts values in [0, 1] without throwing", async () => {
    const player = await makePlayer();
    expect(() => player.setGain(0, 0)).not.toThrow();
    expect(() => player.setGain(0, 0.5)).not.toThrow();
    expect(() => player.setGain(0, 1)).not.toThrow();
    player.dispose();
  });

  // ── tempo / pitch ─────────────────────────────────────────────────────────────

  it("setTempo does not throw", async () => {
    const player = await makePlayer();
    expect(() => player.setTempo(1.2)).not.toThrow();
    player.dispose();
  });

  it("setPitch does not throw", async () => {
    const player = await makePlayer();
    expect(() => player.setPitch(2)).not.toThrow();
    player.dispose();
  });

  it("setTempo while playing reschedules without throwing", async () => {
    const player = await makePlayer();
    player.play();
    expect(() => player.setTempo(1.5)).not.toThrow();
    player.pause();
    player.dispose();
  });

  // ── scheduleSeek ──────────────────────────────────────────────────────────────

  it("scheduleSeek while not playing updates position immediately", async () => {
    const player = await makePlayer();
    player.scheduleSeek(0.7);
    expect(player.getPosition()).toBe(0.7);
    player.dispose();
  });

  it("scheduleSeek while playing reports new position immediately", async () => {
    const player = await makePlayer();
    player.play();
    player.scheduleSeek(0.4);
    expect(player.getPosition()).toBe(0.4);
    player.pause();
    player.dispose();
  });

  it("scheduleSeek into a silent gap between chunks does not throw", async () => {
    // Two chunks: 0–1s and 3–4s, with a 2s gap in between.
    const chunks: AudioChunk[][] = [[
      makeMonoChunk(ctx, 0, 1),
      makeMonoChunk(ctx, SAMPLE_RATE * 3, 1),
    ]];
    const player = await AudioDriver.create(ctx, chunks, {
      tracks: [{}],
      onAmplitudes: () => {},
    });
    player.play();
    expect(() => player.scheduleSeek(1.5)).not.toThrow();
    player.pause();
    player.dispose();
  });

  // ── audio output ──────────────────────────────────────────────────────────────

  it("passes a mono chunk signal through to the output", async () => {
    const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const chunkBuf = offlineCtx.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
    const data = chunkBuf.getChannelData(0);
    for (let i = 0; i < SAMPLE_RATE; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }

    const player = await AudioDriver.create(
      offlineCtx as unknown as AudioContext,
      [[{ sampleOffset: 0, audioBuffer: chunkBuf }]],
      { tracks: [{}], onAmplitudes: () => {} },
    );
    player.connect(offlineCtx.destination);
    player.play();

    const rendered = await offlineCtx.startRendering();
    expect(computeRms(rendered.getChannelData(0))).toBeGreaterThan(0.1);
    player.dispose();
  });

  it("muted track produces near-silent output", async () => {
    const offlineCtx = new OfflineAudioContext(2, SAMPLE_RATE, SAMPLE_RATE);
    const chunkBuf = offlineCtx.createBuffer(1, SAMPLE_RATE, SAMPLE_RATE);
    const data = chunkBuf.getChannelData(0);
    for (let i = 0; i < SAMPLE_RATE; i++) {
      data[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }

    const player = await AudioDriver.create(
      offlineCtx as unknown as AudioContext,
      [[{ sampleOffset: 0, audioBuffer: chunkBuf }]],
      { tracks: [{}], onAmplitudes: () => {} },
    );
    player.setGain(0, 0);
    player.connect(offlineCtx.destination);
    player.play();

    const rendered = await offlineCtx.startRendering();
    expect(computeRms(rendered.getChannelData(0))).toBeLessThan(0.05);
    player.dispose();
  });

  it("a chunk starting after position zero is silent until it begins", async () => {
    const sr = SAMPLE_RATE;
    const offlineCtx = new OfflineAudioContext(2, sr, sr);

    // Chunk starts at 0.5s into the recording, duration 0.5s.
    // Rendering 1s total: first 0.5s should be silent.
    const chunkBuf = offlineCtx.createBuffer(1, Math.floor(sr * 0.5), sr);
    const data = chunkBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = 0.5;
    }

    const player = await AudioDriver.create(
      offlineCtx as unknown as AudioContext,
      [[{ sampleOffset: Math.floor(sr * 0.5), audioBuffer: chunkBuf }]],
      { tracks: [{}], onAmplitudes: () => {} },
    );
    player.connect(offlineCtx.destination);
    player.play();

    const rendered = await offlineCtx.startRendering();
    const firstHalf = rendered.getChannelData(0).subarray(0, Math.floor(sr * 0.4));
    expect(computeRms(firstHalf)).toBeLessThan(0.01);
    player.dispose();
  });

  // ── dispose ───────────────────────────────────────────────────────────────────

  it("dispose does not throw", async () => {
    const player = await makePlayer();
    expect(() => player.dispose()).not.toThrow();
  });

  it("dispose while playing stops without throwing", async () => {
    const player = await makePlayer();
    player.play();
    expect(() => player.dispose()).not.toThrow();
  });
});
