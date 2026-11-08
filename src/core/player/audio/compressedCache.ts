import axios from "axios";

import type { ByteRange } from "./audioIndex";

const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024;
const PARTIAL_CONTENT = 206;
const OK = 200;

/**
 * Downloaded recording bytes, kept across song reloads so timing edits refetch nothing. Whole files
 * (fetched for the waveform) also serve every range of that file. The least recently used go first.
 */
export class CompressedCache {
  private readonly entries = new Map<string, Uint8Array>();
  private size = 0;

  constructor(private readonly budget = DEFAULT_BUDGET_BYTES) {}

  async fetchRange(url: string, { start, end }: ByteRange, signal?: AbortSignal): Promise<Uint8Array> {
    const whole = this.touch(url);
    if (whole) {
      return whole.subarray(start, end);
    }

    const key = `${url}#${start}-${end}`;
    const cached = this.touch(key);
    if (cached) {
      return cached;
    }

    const res = await axios.get<ArrayBuffer>(url, {
      headers: { Range: `bytes=${start}-${end - 1}` },
      responseType: "arraybuffer",
      validateStatus: status => status === PARTIAL_CONTENT || status === OK,
      signal,
    });

    // A server that ignores the range sends the whole file.
    if (res.status === OK) {
      const bytes = new Uint8Array(res.data);
      this.store(url, bytes);
      return bytes.subarray(start, end);
    }

    const bytes = new Uint8Array(res.data);
    this.store(key, bytes);
    return bytes;
  }

  async fetchAll(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    const cached = this.touch(url);
    if (cached) {
      return cached;
    }

    const res = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", validateStatus: status => status === OK, signal });
    const bytes = new Uint8Array(res.data);
    this.dropRanges(url);
    this.store(url, bytes);
    return bytes;
  }

  clear(): void {
    this.entries.clear();
    this.size = 0;
  }

  private touch(key: string): Uint8Array | undefined {
    const bytes = this.entries.get(key);
    if (bytes) {
      this.entries.delete(key);
      this.entries.set(key, bytes);
    }

    return bytes;
  }

  private store(key: string, bytes: Uint8Array): void {
    this.delete(key);
    this.entries.set(key, bytes);
    this.size += bytes.byteLength;
    for (const [oldest, old] of this.entries) {
      if (this.size <= this.budget || oldest === key) {
        break;
      }

      this.entries.delete(oldest);
      this.size -= old.byteLength;
    }
  }

  private dropRanges(url: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${url}#`)) {
        this.delete(key);
      }
    }
  }

  private delete(key: string): void {
    const bytes = this.entries.get(key);
    if (bytes) {
      this.entries.delete(key);
      this.size -= bytes.byteLength;
    }
  }
}

export const sharedCompressedCache = new CompressedCache();
