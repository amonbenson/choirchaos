import type { Decoder, StreamInfo } from "../decoder";
import type { Mp3Index } from "./mp3Index";
import { parseMp3Index, seekByteOffset } from "./mp3Index";

export default class Mp3Decoder implements Decoder {
  readonly headerBytes = 8192;

  private mp3Index: Mp3Index | null = null;

  parseHeader(data: Uint8Array): StreamInfo | null {
    this.mp3Index = parseMp3Index(data);
    if (!this.mp3Index) {
      return null;
    }

    return {
      audioStartOffset: this.mp3Index.audioStartOffset,
      totalAudioBytes: this.mp3Index.totalAudioBytes,
      durationSeconds: this.mp3Index.durationSeconds,
      sampleRate: this.mp3Index.sampleRate,
      channels: this.mp3Index.channels,
    };
  }

  seekOffset(info: StreamInfo, targetSeconds: number): number {
    if (!this.mp3Index) {
      return info.audioStartOffset;
    }

    return seekByteOffset(this.mp3Index, targetSeconds);
  }

  contextBytes(_info: StreamInfo): number {
    if (!this.mp3Index) {
      return 0;
    }

    const { bitrateKbps, sampleRate } = this.mp3Index;
    return 4 * Math.floor((144 * bitrateKbps * 1000) / sampleRate);
  }

  contextSamples(contextBytes: number, info: StreamInfo): number {
    if (!this.mp3Index) {
      return 0;
    }

    const seconds = (contextBytes * 8) / (this.mp3Index.bitrateKbps * 1000);
    return Math.round(seconds * info.sampleRate);
  }
}
