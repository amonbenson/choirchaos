import type { AudioChunk } from "./chunkDetector";

/**
 * Sums the silence-stripped chunks of all tracks into one mono buffer for waveform display.
 * The result is scaled down if the sum clips, so loud passages keep their shape.
 */
export type CreateMonoBuffer = (length: number, sampleRate: number) => AudioBuffer;

const createMonoBuffer: CreateMonoBuffer = (length, sampleRate) => new AudioBuffer({ numberOfChannels: 1, length, sampleRate });

export function mixdownChunks(trackChunks: AudioChunk[][], createBuffer: CreateMonoBuffer = createMonoBuffer): AudioBuffer | undefined {
  const chunks = trackChunks.flat();
  const first = chunks[0];
  if (!first) {
    return undefined;
  }

  const sampleRate = first.audioBuffer.sampleRate;
  const length = Math.max(...chunks.map(chunk => chunk.sampleOffset + chunk.audioBuffer.length));
  const mix = createBuffer(length, sampleRate);
  const output = mix.getChannelData(0);

  for (const chunk of chunks) {
    addInto(output.subarray(chunk.sampleOffset), chunk.audioBuffer.getChannelData(0));
  }

  let peak = 0;
  for (let i = 0; i < output.length; i++) {
    peak = Math.max(peak, Math.abs(output[i]!));
  }

  if (peak > 1) {
    for (let i = 0; i < output.length; i++) {
      output[i]! /= peak;
    }
  }

  return mix;
}

function addInto(target: Float32Array, source: Float32Array): void {
  const length = Math.min(target.length, source.length);
  for (let i = 0; i < length; i++) {
    target[i]! += source[i]!;
  }
}
