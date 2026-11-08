import axios, { type AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildIndexEntry, readToneFixture } from "@/test/opus";

import { SeekIndex } from "./audioIndex";
import BlockStore, { BLOCK_OVERLAP_SECONDS, BLOCK_SECONDS } from "./blockStore";
import { CompressedCache } from "./compressedCache";
import { OPUS_SAMPLE_RATE } from "./oggOpus";
import { OpusDecodingService } from "./opusDecoding";

vi.mock("axios");

const URL = "https://pb.test/tone.opus";
const bytes = readToneFixture();

/** Serves the fixture by byte range, like PocketBase. */
function serveFixture(): void {
  vi.mocked(axios.get).mockImplementation(async (_url: string, config?: AxiosRequestConfig) => {
    const match = /bytes=(\d+)-(\d+)/.exec(String(config?.headers?.Range ?? ""));
    if (!match) {
      return { status: 200, data: bytes.slice().buffer };
    }

    return { status: 206, data: bytes.slice(Number(match[1]), Number(match[2]) + 1).buffer };
  });
}

function nextLoad(store: BlockStore): Promise<void> {
  return new Promise((resolve, reject) => {
    store.onBlockLoaded(() => resolve());
    store.onBlockFailed(reject);
  });
}

async function loadAll(store: BlockStore, from: number, to: number): Promise<void> {
  store.want([{ from, to }]);
  while (!store.isLoaded({ from, to })) {
    await nextLoad(store);
  }
}

describe("BlockStore", () => {
  let ctx: OfflineAudioContext;
  let decoding: OpusDecodingService;
  let store: BlockStore;

  beforeEach(() => {
    serveFixture();
    ctx = new OfflineAudioContext(1, 1, OPUS_SAMPLE_RATE);
    decoding = new OpusDecodingService();
    store = new BlockStore(ctx, [{ url: URL, index: new SeekIndex(buildIndexEntry(bytes)) }], decoding, new CompressedCache());
  });

  afterEach(() => {
    store.dispose();
    decoding.dispose();
    vi.clearAllMocks();
  });

  it("splits the recording into blocks", () => {
    expect(store.getSampleCount()).toBe(12 * OPUS_SAMPLE_RATE);
    expect(store.getBlockCount()).toBe(Math.ceil(12 / BLOCK_SECONDS));
  });

  it("loads the wanted blocks, each running on into the next", async () => {
    await loadAll(store, 0, BLOCK_SECONDS);

    const block = store.getBlock(0, 0);
    expect(block?.length).toBe((BLOCK_SECONDS + BLOCK_OVERLAP_SECONDS) * OPUS_SAMPLE_RATE);
    expect(store.getBlock(0, 1)).toBeUndefined();
  });

  it("marks a block without sound as silent", async () => {
    await loadAll(store, BLOCK_SECONDS, BLOCK_SECONDS * 2);

    expect(store.getBlock(0, 1)).toBeNull();
  });

  it("cuts the last block where the recording ends", async () => {
    await loadAll(store, 10, 12);

    expect(store.getBlock(0, 2)?.length).toBe(2 * OPUS_SAMPLE_RATE);
  });

  it("decodes the overlap like the start of the next block", async () => {
    await loadAll(store, 0, 12);

    const tail = store.getBlock(0, 0)!.getChannelData(0).subarray(BLOCK_SECONDS * OPUS_SAMPLE_RATE);
    const decoded = await decoding.decode({
      pages: bytes.subarray(new SeekIndex(buildIndexEntry(bytes)).getByteRange(0, 0, 0).start),
      preSkip: buildIndexEntry(bytes).preSkip,
      from: BLOCK_SECONDS * OPUS_SAMPLE_RATE,
      to: BLOCK_SECONDS * OPUS_SAMPLE_RATE + tail.length,
    });
    tail.forEach((sample, i) => expect(sample).toBeCloseTo(decoded[i]!, 4));
  });

  it("drops blocks that are no longer wanted", async () => {
    await loadAll(store, 0, BLOCK_SECONDS);
    store.want([{ from: 10, to: 12 }]);

    expect(store.getBlock(0, 0)).toBeUndefined();
    expect(store.isLoaded({ from: 0, to: 1 })).toBe(false);
  });

  it("fetches byte ranges, not the whole file", async () => {
    await loadAll(store, 10, 12);

    const ranges = vi.mocked(axios.get).mock.calls.map(([, config]) => (config as AxiosRequestConfig).headers?.Range);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).not.toBe(`bytes=0-${bytes.length - 1}`);
  });
});
