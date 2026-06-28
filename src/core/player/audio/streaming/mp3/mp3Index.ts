const BITRATE_TABLE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const SAMPLE_RATE_TABLE = [44100, 48000, 32000, 0];
const SAMPLES_PER_FRAME = 1152;

export type Mp3Index = {
  audioStartOffset: number;
  totalAudioBytes: number;
  totalFrames: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  bitrateKbps: number;
  toc: Uint8Array | null;
};

type FrameInfo = {
  bitrateKbps: number;
  sampleRate: number;
  channels: number;
  frameSize: number;
};

function findFirstFrame(data: Uint8Array, from = 0): number {
  for (let i = from; i < data.length - 3; i++) {
    if (data[i] === 0xff && (data[i + 1]! & 0xe0) === 0xe0) {
      return i;
    }
  }

  return -1;
}

function parseFrameInfo(data: Uint8Array, offset: number): FrameInfo | null {
  if (offset + 4 > data.length) {
    return null;
  }

  const b1 = data[offset + 1]!;
  const b2 = data[offset + 2]!;
  const b3 = data[offset + 3]!;

  const version = (b1 >> 3) & 3;
  const layer = (b1 >> 1) & 3;
  if (version !== 3 || layer !== 1) {
    return null;
  }

  const bitrateIdx = (b2 >> 4) & 0xf;
  const sampleRateIdx = (b2 >> 2) & 3;
  const padding = (b2 >> 1) & 1;
  const channelMode = (b3 >> 6) & 3;

  const bitrateKbps = BITRATE_TABLE_V1_L3[bitrateIdx]!;
  const sampleRate = SAMPLE_RATE_TABLE[sampleRateIdx]!;
  if (bitrateKbps === 0 || sampleRate === 0) {
    return null;
  }

  const frameSize = Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding;
  const channels = channelMode === 3 ? 1 : 2;

  return { bitrateKbps, sampleRate, channels, frameSize };
}

export function parseMp3Index(data: Uint8Array): Mp3Index | null {
  const firstFrame = findFirstFrame(data);
  if (firstFrame < 0) {
    return null;
  }

  const info = parseFrameInfo(data, firstFrame);
  if (!info) {
    return null;
  }

  const sideInfoSize = info.channels === 1 ? 17 : 32;
  const xingOffset = firstFrame + 4 + sideInfoSize;

  if (xingOffset + 8 <= data.length) {
    const tag = String.fromCharCode(
      data[xingOffset]!, data[xingOffset + 1]!, data[xingOffset + 2]!, data[xingOffset + 3]!,
    );

    if (tag === "Xing" || tag === "Info") {
      const flags
        = ((data[xingOffset + 4]! << 24) >>> 0)
          | (data[xingOffset + 5]! << 16)
          | (data[xingOffset + 6]! << 8)
          | data[xingOffset + 7]!;

      let off = xingOffset + 8;
      let totalFrames = 0;
      let totalAudioBytes = 0;
      let toc: Uint8Array | null = null;

      if (flags & 0x01) {
        totalFrames
          = ((data[off]! << 24) >>> 0) | (data[off + 1]! << 16) | (data[off + 2]! << 8) | data[off + 3]!;
        off += 4;
      }

      if (flags & 0x02) {
        totalAudioBytes
          = ((data[off]! << 24) >>> 0) | (data[off + 1]! << 16) | (data[off + 2]! << 8) | data[off + 3]!;
        off += 4;
      }

      if (flags & 0x04) {
        toc = new Uint8Array(data.buffer, data.byteOffset + off, 100);
        off += 100;
      }

      const audioStartOffset = firstFrame + info.frameSize;
      const durationSeconds = totalFrames > 0 ? (totalFrames * SAMPLES_PER_FRAME) / info.sampleRate : 0;

      return {
        audioStartOffset,
        totalAudioBytes: totalAudioBytes > 0 ? totalAudioBytes : data.length - audioStartOffset,
        totalFrames,
        durationSeconds,
        sampleRate: info.sampleRate,
        channels: info.channels,
        bitrateKbps: info.bitrateKbps,
        toc,
      };
    }
  }

  const totalAudioBytes = data.length - firstFrame;
  const durationSeconds = (totalAudioBytes * 8) / (info.bitrateKbps * 1000);

  return {
    audioStartOffset: firstFrame,
    totalAudioBytes,
    totalFrames: 0,
    durationSeconds,
    sampleRate: info.sampleRate,
    channels: info.channels,
    bitrateKbps: info.bitrateKbps,
    toc: null,
  };
}

export function seekByteOffset(index: Mp3Index, targetSeconds: number): number {
  const clamped = Math.max(0, Math.min(index.durationSeconds, targetSeconds));
  const fraction = index.durationSeconds > 0 ? clamped / index.durationSeconds : 0;

  let relativeOffset: number;
  if (index.toc && index.toc.length === 100) {
    const tocIdx = Math.min(Math.floor(fraction * 100), 99);
    relativeOffset = Math.round((index.toc[tocIdx]! / 256) * index.totalAudioBytes);
  } else {
    relativeOffset = Math.round(fraction * index.totalAudioBytes);
  }

  return index.audioStartOffset + relativeOffset;
}
