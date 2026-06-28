import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createStreamingPlayer } from "./index";
import { parseMp3Index, seekByteOffset } from "./mp3/mp3Index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCOMP_PATH = resolve("src/test/data/accomp_example.mp3");
const VOCAL_PATH = resolve("src/test/data/vocal_example.mp3");

function readMp3(path: string): Uint8Array {
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function makeFetchMock(fileBytes: Uint8Array): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation(async (_url: string, options?: RequestInit) => {
    const rangeHeader = (options?.headers as Record<string, string> | undefined)?.Range;

    let start = 0;
    let end = fileBytes.length - 1;
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (m) {
        start = parseInt(m[1]!);
        end = m[2] ? parseInt(m[2]) : fileBytes.length - 1;
      }
    }

    end = Math.min(end, fileBytes.length - 1);
    const slice = fileBytes.slice(start, end + 1);

    return {
      ok: true,
      status: rangeHeader ? 206 : 200,
      arrayBuffer: async () => {
        const copy = new ArrayBuffer(slice.byteLength);
        new Uint8Array(copy).set(slice);
        return copy;
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          const PACKET = 32 * 1024;
          let offset = 0;
          while (offset < slice.length) {
            controller.enqueue(slice.slice(offset, offset + PACKET));
            offset += PACKET;
          }

          controller.close();
        },
      }),
    };
  });
}

function decodeAudioBuffer(ctx: AudioContext, bytes: Uint8Array): Promise<AudioBuffer> {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return ctx.decodeAudioData(copy);
}

function maxChannelDiff(a: AudioBuffer, b: AudioBuffer, skip: number, count: number): number {
  const aData = a.getChannelData(0);
  const bData = b.getChannelData(0);
  const n = Math.min(count, aData.length - skip, bData.length - skip);
  let max = 0;
  for (let i = 0; i < n; i++) {
    const diff = Math.abs((aData[skip + i] ?? 0) - (bData[skip + i] ?? 0));
    if (diff > max) {
      max = diff;
    }
  }

  return max;
}

// ---------------------------------------------------------------------------
// parseMp3Index / seekByteOffset — unit tests
// ---------------------------------------------------------------------------

describe("parseMp3Index", () => {
  const accompBytes = readMp3(ACCOMP_PATH);

  it("parses Xing header from accomp_example.mp3", () => {
    const idx = parseMp3Index(accompBytes);
    expect(idx).not.toBeNull();
    expect(idx!.sampleRate).toBe(44100);
    expect(idx!.channels).toBe(2);
    expect(idx!.bitrateKbps).toBe(128);
    expect(idx!.durationSeconds).toBeCloseTo(483, 0);
    expect(idx!.toc).not.toBeNull();
    expect(idx!.toc!.length).toBe(100);
    expect(idx!.audioStartOffset).toBeGreaterThan(4096);
  });

  it("parses Xing header from vocal_example.mp3", () => {
    const idx = parseMp3Index(readMp3(VOCAL_PATH));
    expect(idx).not.toBeNull();
    expect(idx!.durationSeconds).toBeCloseTo(483, 0);
  });

  it("audioStartOffset is the byte position immediately after the Xing frame", () => {
    const idx = parseMp3Index(accompBytes)!;
    expect(idx.audioStartOffset).toBe(4096 + 417);
  });
});

describe("seekByteOffset", () => {
  const accompBytes = readMp3(ACCOMP_PATH);

  it("returns audioStartOffset for t=0", () => {
    const idx = parseMp3Index(accompBytes)!;
    expect(seekByteOffset(idx, 0)).toBe(idx.audioStartOffset);
  });

  it("returns a value <= fileSize for t=duration", () => {
    const idx = parseMp3Index(accompBytes)!;
    expect(seekByteOffset(idx, idx.durationSeconds)).toBeLessThanOrEqual(accompBytes.length);
  });

  it("is monotonically non-decreasing with time", () => {
    const idx = parseMp3Index(accompBytes)!;
    const times = [0, 30, 60, 120, 240, 480];
    const offsets = times.map(t => seekByteOffset(idx, t));
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]).toBeGreaterThan(offsets[i - 1]!);
    }
  });
});

// ---------------------------------------------------------------------------
// StreamingAudioPlayer integration tests
// ---------------------------------------------------------------------------

describe("StreamingAudioPlayer", () => {
  const accompBytes = readMp3(ACCOMP_PATH);
  let ctx: AudioContext;

  beforeEach(() => {
    ctx = new AudioContext();
    vi.stubGlobal("fetch", makeFetchMock(accompBytes));
  });

  afterEach(async () => {
    await ctx.close();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // -- basic API -------------------------------------------------------------

  it("create() succeeds and exposes an AudioNode", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    expect(player.output).toBeDefined();
    expect(typeof (player.output as AudioNode).connect).toBe("function");
    player.dispose();
  });

  it("getDuration() returns the Xing-parsed duration", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    expect(player.getDuration()).toBeCloseTo(483, 0);
    player.dispose();
  });

  it("getPosition() returns 0 before play()", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    expect(player.getPosition()).toBe(0);
    player.dispose();
  });

  it("getPosition() advances after play() is called", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    player.play();
    await new Promise(r => setTimeout(r, 50));
    expect(player.getPosition()).toBeGreaterThan(0);
    player.dispose();
  });

  it("getPosition() freezes after pause()", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    player.play();
    await new Promise(r => setTimeout(r, 30));
    player.pause();
    const frozen = player.getPosition();
    await new Promise(r => setTimeout(r, 30));
    expect(player.getPosition()).toBe(frozen);
    player.dispose();
  });

  it("throws for an unsupported file type", async () => {
    await expect(createStreamingPlayer(ctx, "http://test/song.ogg")).rejects.toThrow("ogg");
  });

  // -- PCM comparison: first chunk vs conventional decodeAudioData -----------

  it("first decoded chunk matches conventional decodeAudioData on the same bytes", async () => {
    const idx = parseMp3Index(accompBytes)!;
    const chunkEnd = idx.audioStartOffset + 512 * 1024;
    const chunkBytes = accompBytes.slice(idx.audioStartOffset, chunkEnd);

    const referenceBuffer = await decodeAudioBuffer(ctx, chunkBytes);

    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    await player.waitForFirstChunk();
    player.dispose();

    const chunks = player.getDecodedChunks();
    expect(chunks.length).toBeGreaterThan(0);

    const streamBuffer = chunks[0]!.buffer;

    const skip = Math.round(0.5 * 44100);
    const compare = Math.round(5 * 44100);
    const diff = maxChannelDiff(referenceBuffer, streamBuffer, skip, compare);

    expect(diff).toBeLessThan(1e-4);
  });

  // -- Seeking ---------------------------------------------------------------

  it("seek() sets getPosition() when paused", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    player.seek(60);
    expect(player.getPosition()).toBe(60);
    player.dispose();
  });

  it("first decoded chunk after seek matches conventional decodeAudioData at same byte offset", async () => {
    const idx = parseMp3Index(accompBytes)!;
    const seekSeconds = 30;
    const seekByte = seekByteOffset(idx, seekSeconds);
    const chunkEnd = seekByte + 512 * 1024;
    const chunkBytes = accompBytes.slice(seekByte, chunkEnd);

    const referenceBuffer = await decodeAudioBuffer(ctx, chunkBytes);

    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    player.seek(seekSeconds);
    await player.waitForFirstChunk();
    player.dispose();

    const chunks = player.getDecodedChunks();
    const seekChunk = chunks.find(c => c.startSeconds >= seekSeconds - 1);
    expect(seekChunk).toBeDefined();

    const skip = Math.round(0.5 * 44100);
    const compare = Math.round(4 * 44100);
    const diff = maxChannelDiff(referenceBuffer, seekChunk!.buffer, skip, compare);

    expect(diff).toBeLessThan(1e-4);
  });

  it("second seek overwrites position and restarts buffering", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    await player.waitForFirstChunk();

    player.seek(60);
    await player.waitForFirstChunk();
    player.dispose();

    const chunks = player.getDecodedChunks();
    const postSeek = chunks.filter(c => c.startSeconds >= 59);
    expect(postSeek.length).toBeGreaterThan(0);
  });

  it("output AudioNode can be connected to destination without errors", async () => {
    const player = await createStreamingPlayer(ctx, "http://test/a.mp3");
    expect(() => player.output.connect(ctx.destination)).not.toThrow();
    player.dispose();
  });
});
