import { describe, expect, it } from "vitest";
import WaveformData from "waveform-data";

import { buildIndexEntry, readToneFixture, TONE } from "@/test/opus";

import { SeekIndex } from "./audioIndex";
import { OPUS_SAMPLE_RATE } from "./oggOpus";
import { OpusDecodingService } from "./opusDecoding";

const SAMPLES_PER_PIXEL = 480;

describe("buildWaveformData", () => {
  const bytes = readToneFixture();
  const index = new SeekIndex(buildIndexEntry(bytes));
  const track = { pages: bytes.subarray(index.getByteRange(0, 0, 0).start), preSkip: index.getPreSkip() };

  async function build(tracks = [track]): Promise<WaveformData> {
    const service = new OpusDecodingService();
    const data = await service.buildWaveform({ tracks, length: index.getSampleCount(), samplesPerPixel: SAMPLES_PER_PIXEL });
    return WaveformData.create(data);
  }

  function peakAt(waveform: WaveformData, seconds: number): number {
    const pixel = Math.floor((seconds * OPUS_SAMPLE_RATE) / SAMPLES_PER_PIXEL);
    return waveform.channel(0).max_sample(pixel);
  }

  it("covers the recording at the requested resolution", async () => {
    const waveform = await build();

    expect(waveform.sample_rate).toBe(OPUS_SAMPLE_RATE);
    expect(waveform.scale).toBe(SAMPLES_PER_PIXEL);
    expect(waveform.length).toBe((TONE.seconds * OPUS_SAMPLE_RATE) / SAMPLES_PER_PIXEL);
  });

  it("follows where the recording sounds, unscaled while it does not clip", async () => {
    const waveform = await build();

    expect(peakAt(waveform, 1)).toBeCloseTo(127 * TONE.amplitude, -0.5);
    expect(peakAt(waveform, 6)).toBe(0);
    expect(peakAt(waveform, 11)).toBeCloseTo(127 * TONE.amplitude, -0.5);
  });

  it("sums the tracks", async () => {
    const single = await build();
    const double = await build([track, track]);

    expect(peakAt(double, 1)).toBeCloseTo(2 * peakAt(single, 1), -0.5);
    expect(peakAt(double, 6)).toBe(0);
  });
});
