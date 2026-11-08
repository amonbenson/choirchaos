/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AudioIndexEntry } from "@/core/player/audio/audioIndex";
import { parseOggPages } from "@/core/player/audio/oggOpus";

/**
 * `tone.opus`: 12 s of mono Ogg Opus with half-second pages, as the backend stores recordings. A 440 Hz
 * sine (ffmpeg's, at 1/8 amplitude, halved) plays until 2 s and again from 10.5 s, silence in between.
 */
export const TONE = { seconds: 12, silentFrom: 2, silentTo: 10.5, amplitude: 1 / 16 };

export function readToneFixture(): Uint8Array {
  return new Uint8Array(readFileSync(resolve(process.cwd(), "src/test/data/tone.opus")));
}

const OGG_HEADER_SIZE = 27;

/** The index entry the backend's `audio.js` writes, rebuilt here so tests need no backend. */
export function buildIndexEntry(bytes: Uint8Array): AudioIndexEntry {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pageBytes: number[] = [];
  const pageSamples: number[] = [];
  let pos = 0;
  let headerPackets = 0;
  let headerBytes = 0;
  let lastGranule = 0;
  const preSkip = view.getUint16(OGG_HEADER_SIZE + bytes[26]! + 10, true);
  while (pos < bytes.length) {
    const segments = bytes[pos + 26]!;
    const lacing = bytes.subarray(pos + OGG_HEADER_SIZE, pos + OGG_HEADER_SIZE + segments);
    const size = OGG_HEADER_SIZE + segments + lacing.reduce((sum, value) => sum + value, 0);
    if (headerPackets < 2) {
      headerPackets += lacing.filter(value => value < 255).length;
      headerBytes = pos + size;
    } else {
      const [page] = parseOggPages(bytes.subarray(pos, pos + size));
      const advance = page!.granule < 0 ? 0 : page!.granule - lastGranule;
      pageBytes.push(size);
      pageSamples.push(advance);
      lastGranule += advance;
    }

    pos += size;
  }

  return { preSkip, headerBytes, pageBytes, pageSamples };
}
