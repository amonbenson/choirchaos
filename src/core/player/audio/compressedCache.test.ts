import axios, { type AxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompressedCache } from "./compressedCache";

vi.mock("axios");

const FILE = Uint8Array.from({ length: 100 }, (_, i) => i);

function rangeOf(config?: AxiosRequestConfig): [number, number] | undefined {
  const match = /bytes=(\d+)-(\d+)/.exec(String(config?.headers?.Range ?? ""));
  return match ? [Number(match[1]), Number(match[2]) + 1] : undefined;
}

describe("CompressedCache", () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockImplementation(async (_url: string, config?: AxiosRequestConfig) => {
      const range = rangeOf(config);
      return range ? { status: 206, data: FILE.slice(...range).buffer } : { status: 200, data: FILE.slice().buffer };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches a range once", async () => {
    const cache = new CompressedCache();
    const first = await cache.fetchRange("a", { start: 10, end: 20 });
    const second = await cache.fetchRange("a", { start: 10, end: 20 });

    expect([...first]).toEqual([...FILE.slice(10, 20)]);
    expect(second).toBe(first);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it("serves ranges from a whole file", async () => {
    const cache = new CompressedCache();
    await cache.fetchAll("a");

    expect([...await cache.fetchRange("a", { start: 5, end: 8 })]).toEqual([5, 6, 7]);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it("keeps the whole file when the server ignores the range", async () => {
    vi.mocked(axios.get).mockResolvedValue({ status: 200, data: FILE.slice().buffer });
    const cache = new CompressedCache();

    expect([...await cache.fetchRange("a", { start: 5, end: 8 })]).toEqual([5, 6, 7]);
    expect([...await cache.fetchRange("a", { start: 50, end: 52 })]).toEqual([50, 51]);
    expect(axios.get).toHaveBeenCalledOnce();
  });

  it("forgets the least recently used entries beyond its budget", async () => {
    const cache = new CompressedCache(25);
    await cache.fetchRange("a", { start: 0, end: 10 });
    await cache.fetchRange("b", { start: 0, end: 10 });
    await cache.fetchRange("a", { start: 0, end: 10 });
    await cache.fetchRange("c", { start: 0, end: 10 });
    vi.mocked(axios.get).mockClear();

    await cache.fetchRange("a", { start: 0, end: 10 });
    expect(axios.get).not.toHaveBeenCalled();
    await cache.fetchRange("b", { start: 0, end: 10 });
    expect(axios.get).toHaveBeenCalledOnce();
  });
});
