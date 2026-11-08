import { describe, expect, it } from "vitest";

import { computeRms } from "@/test/fixtures";
import { buildIndexEntry, readToneFixture, TONE } from "@/test/opus";

import { SeekIndex } from "./audioIndex";
import { extractOpusPackets, getPacketSamples, OPUS_SAMPLE_RATE } from "./oggOpus";
import { OpusDecodingService } from "./opusDecoding";

const LEAD_IN = 0.4 * OPUS_SAMPLE_RATE;

describe("getPacketSamples", () => {
  it("reads frame size and count from the TOC byte", () => {
    expect(getPacketSamples(new Uint8Array([31 << 3]))).toBe(960);
    expect(getPacketSamples(new Uint8Array([(16 << 3) | 1]))).toBe(240);
    expect(getPacketSamples(new Uint8Array([(3 << 3) | 3, 2]))).toBe(5760);
  });
});

describe("Ogg Opus decoding", () => {
  const bytes = readToneFixture();
  const index = new SeekIndex(buildIndexEntry(bytes));

  async function decodeRange(from: number, to: number): Promise<Float32Array> {
    const { start, end } = index.getByteRange(from, to, LEAD_IN);
    const service = new OpusDecodingService();
    try {
      return await service.decode({ pages: bytes.subarray(start, end), preSkip: index.getPreSkip(), from, to });
    } finally {
      service.dispose();
    }
  }

  it("indexes the whole recording", () => {
    expect(index.getSampleCount()).toBe(TONE.seconds * OPUS_SAMPLE_RATE);
    expect(index.getByteLength()).toBe(bytes.length);
  });

  it("times every packet back from its page's granule position", () => {
    const packets = extractOpusPackets(bytes.subarray(index.getByteRange(0, 0, 0).start), index.getPreSkip());

    expect(packets[0]!.start).toBe(-index.getPreSkip());
    packets.slice(1).forEach((packet, i) => expect(packet.start).toBe(packets[i]!.start + getPacketSamples(packets[i]!.data)));
  });

  it("decodes a range the same as decoding from the start", async () => {
    const from = Math.round(1.3 * OPUS_SAMPLE_RATE);
    const to = from + OPUS_SAMPLE_RATE / 2;
    const whole = await decodeRange(0, to);
    const range = await decodeRange(from, to);

    let maxDiff = 0;
    range.forEach((sample, i) => {
      maxDiff = Math.max(maxDiff, Math.abs(sample - whole[from + i]!));
    });
    expect(maxDiff).toBeLessThan(1e-4);
    expect(computeRms(range)).toBeCloseTo(TONE.amplitude / Math.SQRT2, 2);
  });

  it("fetches only the pages around a range", () => {
    const { start, end } = index.getByteRange(6 * OPUS_SAMPLE_RATE, 7 * OPUS_SAMPLE_RATE, LEAD_IN);

    expect(start).toBeGreaterThan(index.getByteRange(0, 0, 0).start);
    expect(end).toBeLessThan(bytes.length);
  });

  it("decodes silence where the recording is silent", async () => {
    const samples = await decodeRange(5 * OPUS_SAMPLE_RATE, 10 * OPUS_SAMPLE_RATE);

    expect(samples.every(sample => Math.abs(sample) < 0.001)).toBe(true);
  });
});
