import { extractOpusPackets, OPUS_SAMPLE_RATE, type OpusFrameDecoder, type OpusPacket } from "./oggOpus";

/** The finest waveform resolution, in samples per pixel. */
export const WAVEFORM_SAMPLES_PER_PIXEL = 32;

/** The mixdown of a song's recordings in the binary format of `waveform-data`. */
export type RecordingWaveform = { data: ArrayBuffer; sampleRate: number; samplesPerPixel: number; length: number };

/** A whole recording for the waveform: its audio pages and pre-skip. */
export type WaveformTrack = { pages: Uint8Array; preSkip: number };

const HEADER_SIZE = 24;
const FORMAT_VERSION = 2;
const EIGHT_BIT = 1;
const MAX_INT8 = 127;
const MIX_CHUNK = OPUS_SAMPLE_RATE;

/** Decodes one track packet by packet, so the mix only ever holds a chunk of each. */
class TrackCursor {
  private next = 0;
  private pending: { start: number; samples: Float32Array } | undefined;

  constructor(private readonly decoder: OpusFrameDecoder, private readonly packets: OpusPacket[]) {}

  addInto(mix: Float32Array, from: number): void {
    const to = from + mix.length;
    for (;;) {
      if (this.pending) {
        const { start, samples } = this.pending;
        const first = Math.max(from, start);
        const last = Math.min(to, start + samples.length);
        for (let t = first; t < last; t++) {
          mix[t - from]! += samples[t - start]!;
        }

        if (start + samples.length > to) {
          return;
        }

        this.pending = undefined;
      }

      const packet = this.packets[this.next++];
      if (!packet) {
        return;
      }

      const { channelData, samplesDecoded } = this.decoder.decodeFrame(packet.data);
      this.pending = { start: packet.start, samples: (channelData[0] ?? new Float32Array()).slice(0, samplesDecoded) };
    }
  }
}

/**
 * The mixdown of all tracks as a binary waveform for `waveform-data` (version 2, 8 bit, one channel),
 * `samplesPerPixel` samples of `length` per min/max pair. Every track needs its own fresh decoder.
 */
export function buildWaveformData(decoders: OpusFrameDecoder[], tracks: WaveformTrack[], length: number, samplesPerPixel: number): ArrayBuffer {
  const pixels = Math.ceil(length / samplesPerPixel);
  const buffer = new ArrayBuffer(HEADER_SIZE + pixels * 2);
  const view = new DataView(buffer);
  view.setInt32(0, FORMAT_VERSION, true);
  view.setUint32(4, EIGHT_BIT, true);
  view.setInt32(8, OPUS_SAMPLE_RATE, true);
  view.setInt32(12, samplesPerPixel, true);
  view.setUint32(16, pixels, true);
  view.setInt32(20, 1, true);

  const cursors = tracks.map((track, i) => new TrackCursor(decoders[i]!, extractOpusPackets(track.pages, track.preSkip)));
  const peaks = new Float32Array(pixels * 2);
  const chunk = Math.ceil(MIX_CHUNK / samplesPerPixel) * samplesPerPixel;
  let loudest = 0;
  for (let from = 0; from < length; from += chunk) {
    const mix = new Float32Array(Math.min(chunk, length - from));
    cursors.forEach(cursor => cursor.addInto(mix, from));
    for (let i = 0; i < mix.length; i += samplesPerPixel) {
      const pixel = (from + i) / samplesPerPixel;
      let min = 0;
      let max = 0;
      for (let j = i; j < Math.min(i + samplesPerPixel, mix.length); j++) {
        min = Math.min(min, mix[j]!);
        max = Math.max(max, mix[j]!);
      }

      peaks[pixel * 2] = min;
      peaks[pixel * 2 + 1] = max;
      loudest = Math.max(loudest, -min, max);
    }
  }

  // Like the summed buffer it replaces, a mix that clips is scaled down, so loud passages keep their shape.
  const scale = MAX_INT8 / Math.max(1, loudest);
  peaks.forEach((value, i) => view.setInt8(HEADER_SIZE + i, Math.round(value * scale)));
  return buffer;
}
