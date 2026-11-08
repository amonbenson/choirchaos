import { OpusDecoder } from "opus-decoder";

import { decodeOpusRange } from "./oggOpus";
import { buildWaveformData, type WaveformTrack } from "./waveformData";

/** Samples [from, to) of a recording, decoded from audio pages that start a lead-in earlier. */
export type DecodeRequest = { pages: Uint8Array; preSkip: number; from: number; to: number };

export type WaveformRequest = { tracks: WaveformTrack[]; length: number; samplesPerPixel: number };

/** Opus decoding off the main thread; `OpusDecodingService` runs the same work in place for tests. */
export interface OpusDecoding {
  decode(request: DecodeRequest): Promise<Float32Array>;
  buildWaveform(request: WaveformRequest): Promise<ArrayBuffer>;
  dispose(): void;
}

async function createDecoder(): Promise<OpusDecoder> {
  const decoder = new OpusDecoder({ channels: 1, preSkip: 0 });
  await decoder.ready;
  return decoder;
}

/** Decodes one request at a time, since every block reuses one decoder. */
export class OpusDecodingService implements OpusDecoding {
  private decoder: Promise<OpusDecoder> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  decode({ pages, preSkip, from, to }: DecodeRequest): Promise<Float32Array> {
    return this.enqueue(async () => {
      this.decoder ??= createDecoder();
      return await decodeOpusRange(await this.decoder, pages, preSkip, from, to);
    });
  }

  buildWaveform({ tracks, length, samplesPerPixel }: WaveformRequest): Promise<ArrayBuffer> {
    return this.enqueue(async () => {
      const decoders = await Promise.all(tracks.map(() => createDecoder()));
      try {
        return buildWaveformData(decoders, tracks, length, samplesPerPixel);
      } finally {
        decoders.forEach(decoder => decoder.free());
      }
    });
  }

  dispose(): void {
    void this.decoder?.then(decoder => decoder.free());
    this.decoder = undefined;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.catch(() => {});
    return result;
  }
}

export type WorkerRequest
  = | { id: number; kind: "decode"; request: DecodeRequest }
    | { id: number; kind: "waveform"; request: WaveformRequest };

export type WorkerResponse
  = | { id: number; result: Float32Array | ArrayBuffer }
    | { id: number; error: string };

/** Runs an `OpusDecodingService` in a Web Worker, so decoding never holds up playback. */
export class WorkerOpusDecoding implements OpusDecoding {
  private worker: Worker | undefined;
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (result: never) => void; reject: (error: Error) => void }>();

  decode(request: DecodeRequest): Promise<Float32Array> {
    return this.post({ id: this.nextId++, kind: "decode", request });
  }

  buildWaveform(request: WaveformRequest): Promise<ArrayBuffer> {
    return this.post({ id: this.nextId++, kind: "waveform", request });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = undefined;
    this.pending.forEach(({ reject }) => reject(new Error("Opus decoding stopped")));
    this.pending.clear();
  }

  private post<T>(message: WorkerRequest): Promise<T> {
    const worker = this.getWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(message.id, { resolve: resolve as (result: never) => void, reject });
      worker.postMessage(message);
    });
  }

  private getWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(new URL("./opusDecoding.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
      const pending = this.pending.get(data.id);
      this.pending.delete(data.id);
      if ("error" in data) {
        pending?.reject(new Error(data.error));
      } else {
        pending?.resolve(data.result as never);
      }
    };

    worker.onerror = (event) => {
      this.pending.forEach(({ reject }) => reject(new Error(event.message || "Opus decoding failed")));
      this.pending.clear();
    };

    this.worker = worker;
    return worker;
  }
}
