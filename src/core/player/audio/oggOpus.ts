/** Opus always decodes at 48 kHz; granule positions and the index count samples at this rate. */
export const OPUS_SAMPLE_RATE = 48000;

const OGG_CAPTURE_PATTERN = 0x5367674f;
const OGG_HEADER_SIZE = 27;
const CONTINUED_PACKET = 1;
const MAX_LACING = 255;

export type OpusPacket = {
  /** First sample the packet decodes, pre-skip removed. */
  start: number;
  data: Uint8Array;
};

export type OpusFrameDecoder = {
  reset(): Promise<void>;
  decodeFrame(packet: Uint8Array): { channelData: Float32Array[]; samplesDecoded: number };
};

type PacketPiece = { data: Uint8Array; complete: boolean };

type OggPage = { granule: number; continued: boolean; pieces: PacketPiece[] };

function readGranule(view: DataView, offset: number): number {
  const low = view.getUint32(offset, true);
  const high = view.getUint32(offset + 4, true);
  return high === 0xffffffff && low === 0xffffffff ? -1 : high * 2 ** 32 + low;
}

function splitPieces(bytes: Uint8Array, lacing: Uint8Array, bodyStart: number): PacketPiece[] {
  const pieces: PacketPiece[] = [];
  let start = bodyStart;
  let size = 0;
  for (const value of lacing) {
    size += value;
    if (value < MAX_LACING) {
      pieces.push({ data: bytes.subarray(start, start + size), complete: true });
      start += size;
      size = 0;
    }
  }

  if (size > 0) {
    pieces.push({ data: bytes.subarray(start, start + size), complete: false });
  }

  return pieces;
}

/** Parses whole Ogg pages from the start of `bytes`; a truncated last page is ignored. */
export function parseOggPages(bytes: Uint8Array): OggPage[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pages: OggPage[] = [];
  let pos = 0;
  while (pos + OGG_HEADER_SIZE <= bytes.length) {
    if (view.getUint32(pos, true) !== OGG_CAPTURE_PATTERN) {
      throw new Error(`No Ogg page at byte ${pos}`);
    }

    const segments = bytes[pos + 26]!;
    const bodyStart = pos + OGG_HEADER_SIZE + segments;
    if (bodyStart > bytes.length) {
      break;
    }

    const lacing = bytes.subarray(pos + OGG_HEADER_SIZE, bodyStart);
    const bodySize = lacing.reduce((sum, value) => sum + value, 0);
    if (bodyStart + bodySize > bytes.length) {
      break;
    }

    const continued = (bytes[pos + 5]! & CONTINUED_PACKET) !== 0;
    pages.push({ granule: readGranule(view, pos + 6), continued, pieces: splitPieces(bytes, lacing, bodyStart) });
    pos = bodyStart + bodySize;
  }

  return pages;
}

/** The samples an Opus packet decodes to, from its TOC byte (RFC 6716, section 3.1). */
export function getPacketSamples(packet: Uint8Array): number {
  const toc = packet[0]!;
  const config = toc >> 3;
  let frame: number;
  if (config < 12) {
    frame = [480, 960, 1920, 2880][config % 4]!;
  } else if (config < 16) {
    frame = [480, 960][config % 2]!;
  } else {
    frame = [120, 240, 480, 960][config % 4]!;
  }

  const code = toc & 3;
  const count = code === 0 ? 1 : code === 3 ? packet[1]! & 63 : 2;
  return frame * count;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const joined = new Uint8Array(a.length + b.length);
  joined.set(a);
  joined.set(b, a.length);
  return joined;
}

/**
 * The packets in a run of audio pages with the sample each starts at. The first page's packets count
 * back from its granule position, dropping a packet continued from before the run; later ones follow
 * on, since the last page's granule position is cut to where the recording ends.
 */
export function extractOpusPackets(bytes: Uint8Array, preSkip: number): OpusPacket[] {
  const packets: OpusPacket[] = [];
  let carry: Uint8Array | undefined;
  let cursor: number | undefined;
  for (const page of parseOggPages(bytes)) {
    const complete: (Uint8Array | undefined)[] = [];
    page.pieces.forEach((piece, i) => {
      const data = i === 0 && page.continued ? (carry ? concat(carry, piece.data) : undefined) : piece.data;
      if (i === 0 && page.continued) {
        carry = undefined;
      }

      if (piece.complete) {
        complete.push(data);
      } else {
        carry = data;
      }
    });

    if (cursor !== undefined) {
      for (const data of complete) {
        if (data) {
          packets.push({ start: cursor, data });
          cursor += getPacketSamples(data);
        }
      }

      continue;
    }

    if (page.granule < 0) {
      continue;
    }

    cursor = page.granule - preSkip;
    let start = cursor;
    const timed: OpusPacket[] = [];
    for (let i = complete.length - 1; i >= 0 && complete[i]; i--) {
      start -= getPacketSamples(complete[i]!);
      timed.unshift({ start, data: complete[i]! });
    }

    packets.push(...timed);
  }

  return packets;
}

/**
 * Decodes samples [from, to) of the packets in `bytes` from a clean decoder state, so the pages have to
 * begin a lead-in before `from`. Samples no packet covers stay silent.
 */
export async function decodeOpusRange(decoder: OpusFrameDecoder, bytes: Uint8Array, preSkip: number, from: number, to: number): Promise<Float32Array> {
  await decoder.reset();
  const out = new Float32Array(Math.max(0, to - from));
  for (const packet of extractOpusPackets(bytes, preSkip)) {
    if (packet.start >= to) {
      break;
    }

    const { channelData, samplesDecoded } = decoder.decodeFrame(packet.data);
    const pcm = channelData[0];
    if (!pcm) {
      continue;
    }

    const first = Math.max(0, from - packet.start);
    const last = Math.min(samplesDecoded, to - packet.start);
    if (last > first) {
      out.set(pcm.subarray(first, last), packet.start + first - from);
    }
  }

  return out;
}
