import { Emitter } from "../../utils/events";
import type { SeekIndex } from "./audioIndex";
import type { CompressedCache } from "./compressedCache";
import { OPUS_SAMPLE_RATE } from "./oggOpus";
import type { OpusDecoding } from "./opusDecoding";

export const BLOCK_SECONDS = 5;
const BLOCK_SAMPLES = BLOCK_SECONDS * OPUS_SAMPLE_RATE;
/** Blocks run on this far into the next one, so the driver can crossfade between them. */
export const BLOCK_OVERLAP_SECONDS = 0.005;
const BLOCK_OVERLAP_SAMPLES = BLOCK_OVERLAP_SECONDS * OPUS_SAMPLE_RATE;
/** After a decoder reset, Opus needs this long before its output matches a continuous decode. */
const LEAD_IN_SAMPLES = 0.4 * OPUS_SAMPLE_RATE;
const SILENCE_THRESHOLD = 0.001;
const MAX_CONCURRENT_LOADS = 4;

export type TrackSource = { url: string; index: SeekIndex };

/** A loaded block: its samples, or null when the track is silent throughout it. */
export type Block = AudioBuffer | null;

/** The blocks of every track, for the driver: undefined while a block is not loaded. */
export interface BlockSource {
  getTrackCount(): number;
  getBlockCount(): number;
  getBlock(track: number, index: number): Block | undefined;
}

export type SecondsRange = { from: number; to: number };

function isSilent(samples: Float32Array): boolean {
  return samples.every(sample => Math.abs(sample) < SILENCE_THRESHOLD);
}

/**
 * Loads blocks of `BLOCK_SECONDS` per track on demand and holds only the wanted ones, so memory stays
 * bounded however long the recording is.
 */
export default class BlockStore implements BlockSource {
  private readonly blocks: Map<number, Block>[];
  private readonly loading = new Set<string>();
  private queue: { track: number; index: number }[] = [];
  private wanted = new Set<number>();
  private readonly abortController = new AbortController();
  private readonly blockLoaded = new Emitter<void>();
  private readonly blockFailed = new Emitter<Error>();

  readonly onBlockLoaded = this.blockLoaded.event;
  readonly onBlockFailed = this.blockFailed.event;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly tracks: TrackSource[],
    private readonly decoding: OpusDecoding,
    private readonly cache: CompressedCache,
  ) {
    this.blocks = tracks.map(() => new Map());
  }

  getTrackCount(): number {
    return this.tracks.length;
  }

  /** Samples every track has; longer tracks are cut to the shortest. */
  getSampleCount(): number {
    return this.tracks.length === 0 ? 0 : Math.min(...this.tracks.map(track => track.index.getSampleCount()));
  }

  getBlockCount(): number {
    return Math.ceil(this.getSampleCount() / BLOCK_SAMPLES);
  }

  getBlock(track: number, index: number): Block | undefined {
    return this.blocks[track]?.get(index);
  }

  /** Whether every track has the blocks covering `range` loaded. */
  isLoaded(range: SecondsRange): boolean {
    return this.getBlockIndexes(range).every(index => this.blocks.every(blocks => blocks.has(index)));
  }

  /**
   * Keeps the blocks covering `ranges` and drops all others. Missing blocks load in the order of the
   * ranges, so the first range should be the most urgent.
   */
  want(ranges: SecondsRange[]): void {
    const ordered = [...new Set(ranges.flatMap(range => this.getBlockIndexes(range)))];
    this.wanted = new Set(ordered);
    this.blocks.forEach(blocks => [...blocks.keys()].forEach((index) => {
      if (!this.wanted.has(index)) {
        blocks.delete(index);
      }
    }));

    this.queue = ordered.flatMap(index => this.tracks.flatMap((_, track) => (
      this.blocks[track]!.has(index) || this.loading.has(`${track}:${index}`) ? [] : [{ track, index }]
    )));
    this.pump();
  }

  dispose(): void {
    this.abortController.abort();
    this.queue = [];
    this.wanted.clear();
    this.blocks.forEach(blocks => blocks.clear());
  }

  private getBlockIndexes({ from, to }: SecondsRange): number[] {
    const first = Math.max(0, Math.floor(from / BLOCK_SECONDS));
    const last = Math.min(this.getBlockCount() - 1, Math.ceil(to / BLOCK_SECONDS) - 1);
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
  }

  private pump(): void {
    while (this.loading.size < MAX_CONCURRENT_LOADS && this.queue.length > 0) {
      const { track, index } = this.queue.shift()!;
      const key = `${track}:${index}`;
      this.loading.add(key);
      this.load(track, index)
        .then((block) => {
          if (this.wanted.has(index) && !this.abortController.signal.aborted) {
            this.blocks[track]!.set(index, block);
            this.blockLoaded.fire(undefined);
          }
        })
        .catch((error: unknown) => {
          if (!this.abortController.signal.aborted) {
            this.blockFailed.fire(error instanceof Error ? error : new Error(String(error)));
          }
        })
        .finally(() => {
          this.loading.delete(key);
          this.pump();
        });
    }
  }

  private async load(track: number, index: number): Promise<Block> {
    const source = this.tracks[track]!;
    const from = index * BLOCK_SAMPLES;
    const to = Math.min(from + BLOCK_SAMPLES + BLOCK_OVERLAP_SAMPLES, source.index.getSampleCount());
    const range = source.index.getByteRange(from, to, LEAD_IN_SAMPLES);
    const pages = await this.cache.fetchRange(source.url, range, this.abortController.signal);
    const samples = await this.decoding.decode({ pages, preSkip: source.index.getPreSkip(), from, to });
    if (isSilent(samples)) {
      return null;
    }

    const buffer = this.context.createBuffer(1, samples.length, OPUS_SAMPLE_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    return buffer;
  }
}
