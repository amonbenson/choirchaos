import { describe, expect, it } from "vitest";

import type { AudioChunk } from "./chunkDetector";
import { mixdownChunks } from "./mixdown";

const SAMPLE_RATE = 8000;
const context = new OfflineAudioContext(1, 1, SAMPLE_RATE);
const createBuffer = (length: number, sampleRate: number): AudioBuffer => context.createBuffer(1, length, sampleRate);

function chunk(sampleOffset: number, samples: number[]): AudioChunk {
  const audioBuffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
  audioBuffer.copyToChannel(Float32Array.from(samples), 0);
  return { sampleOffset, audioBuffer };
}

describe("mixdownChunks", () => {
  it("returns nothing without chunks", () => {
    expect(mixdownChunks([[], []], createBuffer)).toBeUndefined();
  });

  it("places chunks at their offsets and sums overlapping tracks", () => {
    const mix = mixdownChunks([[chunk(0, [0.1, 0.1]), chunk(4, [0.2])], [chunk(1, [0.3, 0.3])]], createBuffer)!;

    expect(mix.length).toBe(5);
    expect(Array.from(mix.getChannelData(0)).map(v => Number(v.toFixed(3)))).toEqual([0.1, 0.4, 0.3, 0, 0.2]);
  });

  it("scales the mix down when the sum clips", () => {
    const mix = mixdownChunks([[chunk(0, [0.8, -0.4])], [chunk(0, [0.8, 0])]], createBuffer)!;

    expect(Array.from(mix.getChannelData(0)).map(v => Number(v.toFixed(3)))).toEqual([1, -0.25]);
  });
});
