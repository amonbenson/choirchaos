import type { Decoder, StreamInfo } from "./decoder";

const DECODE_CHUNK_BYTES = 512 * 1024;
const LOOKAHEAD_SECONDS = 15;

export type StreamingPlayerOptions = {
  decodeChunkBytes?: number;
};

type DecodedChunk = {
  buffer: AudioBuffer;
  startSeconds: number;
};

type ScheduledSource = {
  node: AudioBufferSourceNode;
  gain: GainNode;
  endSeconds: number;
};

export default class StreamingAudioPlayer {
  private readonly context: AudioContext;
  private readonly url: string;
  private readonly outputGain: GainNode;
  private readonly decoder: Decoder;
  private readonly decodeChunkBytes: number;

  private info: StreamInfo | null = null;
  private pendingChunks: DecodedChunk[] = [];
  private scheduledSources: ScheduledSource[] = [];
  private scheduledChunks = new Set<DecodedChunk>();

  private playing = false;
  private disposed = false;

  private refContextTime = 0;
  private refPositionSeconds = 0;
  private scheduledUntilSeconds = 0;

  private fetchAbort: AbortController | null = null;
  private prevContextTail: Uint8Array | null = null;

  private firstChunkResolve: (() => void) | null = null;
  private firstChunkPromise: Promise<void>;

  private allDecodedChunks: DecodedChunk[] = [];

  private constructor(
    context: AudioContext,
    url: string,
    decoder: Decoder,
    options: StreamingPlayerOptions,
  ) {
    this.context = context;
    this.url = url;
    this.decoder = decoder;
    this.outputGain = context.createGain();
    this.decodeChunkBytes = options.decodeChunkBytes ?? DECODE_CHUNK_BYTES;
    this.firstChunkPromise = new Promise((resolve) => {
      this.firstChunkResolve = resolve;
    });
  }

  static async create(
    context: AudioContext,
    url: string,
    decoder: Decoder,
    options: StreamingPlayerOptions = {},
  ): Promise<StreamingAudioPlayer> {
    const player = new StreamingAudioPlayer(context, url, decoder, options);
    await player.initialize();
    return player;
  }

  get output(): AudioNode {
    return this.outputGain;
  }

  getDuration(): number {
    return this.info?.durationSeconds ?? 0;
  }

  getPosition(): number {
    if (!this.playing) {
      return this.refPositionSeconds;
    }

    return this.refPositionSeconds + (this.context.currentTime - this.refContextTime);
  }

  getDecodedChunks(): readonly DecodedChunk[] {
    return this.allDecodedChunks;
  }

  play(): void {
    if (this.playing || this.disposed) {
      return;
    }

    this.playing = true;
    this.refContextTime = this.context.currentTime;
    this.scheduledUntilSeconds = this.refPositionSeconds;
    this.scheduleAvailable();
  }

  pause(): void {
    if (!this.playing) {
      return;
    }

    this.refPositionSeconds = this.getPosition();
    this.playing = false;
    this.clearScheduled();
  }

  seek(targetSeconds: number): void {
    const wasPlaying = this.playing;
    this.playing = false;
    this.clearScheduled();

    this.refPositionSeconds = targetSeconds;
    this.scheduledUntilSeconds = targetSeconds;
    this.pendingChunks = [];
    this.prevContextTail = null;

    this.fetchAbort?.abort();
    this.firstChunkPromise = new Promise((resolve) => {
      this.firstChunkResolve = resolve;
    });

    if (!this.disposed) {
      const byteOffset = this.info ? this.decoder.seekOffset(this.info, targetSeconds) : 0;
      this.startFetch(byteOffset, targetSeconds);
      if (wasPlaying) {
        this.playing = true;
        this.refContextTime = this.context.currentTime;
        this.scheduleAvailable();
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.fetchAbort?.abort();
    this.clearScheduled();
    this.outputGain.disconnect();
  }

  waitForFirstChunk(): Promise<void> {
    return this.firstChunkPromise;
  }

  waitForAllChunks(): Promise<void> {
    return new Promise((resolve) => {
      const poll = (): void => {
        if (this.fetchAbort === null) {
          resolve();
        } else {
          setTimeout(poll, 10);
        }
      };

      poll();
    });
  }

  private async initialize(): Promise<void> {
    const head = await this.fetchRange(0, this.decoder.headerBytes - 1);
    if (head) {
      this.info = this.decoder.parseHeader(head);
    }

    const startByte = this.info?.audioStartOffset ?? 0;
    this.startFetch(startByte, 0);
  }

  private startFetch(fromByte: number, fromSeconds: number): void {
    this.fetchAbort?.abort();
    const abort = new AbortController();
    this.fetchAbort = abort;
    void this.fetchLoop(fromByte, fromSeconds, abort.signal);
  }

  private async fetchLoop(fromByte: number, fromSeconds: number, signal: AbortSignal): Promise<void> {
    let currentSeconds = fromSeconds;

    try {
      const response = await fetch(this.url, {
        headers: { Range: `bytes=${fromByte}-` },
        signal,
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Fetch failed: ${response.status}`);
      }

      const reader = response.body!.getReader();
      let accumulator = new Uint8Array(0);

      while (true) {
        const { done, value } = await reader.read();

        if (value && value.length > 0) {
          const merged = new Uint8Array(accumulator.length + value.length);
          merged.set(accumulator);
          merged.set(value, accumulator.length);
          accumulator = merged;
        }

        const shouldDecode = done || accumulator.length >= this.decodeChunkBytes;
        if (shouldDecode && accumulator.length > 0) {
          const decoded = await this.decodeChunk(accumulator, signal);
          if (decoded && !signal.aborted) {
            const chunk: DecodedChunk = { buffer: decoded, startSeconds: currentSeconds };
            this.pendingChunks.push(chunk);
            this.allDecodedChunks.push(chunk);
            this.firstChunkResolve?.();
            this.firstChunkResolve = null;
            currentSeconds += decoded.duration;
            if (this.info) {
              const ctx = this.decoder.contextBytes(this.info);
              this.prevContextTail = ctx > 0 ? accumulator.slice(-ctx) : null;
            }

            if (this.playing) {
              this.scheduleAvailable();
            }
          }

          accumulator = new Uint8Array(0);
        }

        if (done) {
          break;
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[StreamingAudioPlayer] fetch error:", err);
      }
    } finally {
      if (this.fetchAbort?.signal === signal) {
        this.fetchAbort = null;
      }
    }
  }

  private async decodeChunk(raw: Uint8Array, signal: AbortSignal): Promise<AudioBuffer | null> {
    let dataToDecode: Uint8Array;
    let trimSamples = 0;

    if (this.prevContextTail && this.prevContextTail.length > 0 && this.info) {
      dataToDecode = new Uint8Array(this.prevContextTail.length + raw.length);
      dataToDecode.set(this.prevContextTail);
      dataToDecode.set(raw, this.prevContextTail.length);
      trimSamples = this.decoder.contextSamples(this.prevContextTail.length, this.info);
    } else {
      dataToDecode = raw;
    }

    if (signal.aborted) {
      return null;
    }

    let decoded: AudioBuffer;
    try {
      const buf = new ArrayBuffer(dataToDecode.byteLength);
      new Uint8Array(buf).set(dataToDecode);
      decoded = await this.context.decodeAudioData(buf);
    } catch {
      return null;
    }

    if (signal.aborted) {
      return null;
    }

    if (trimSamples > 0 && trimSamples < decoded.length) {
      const trimmedLength = decoded.length - trimSamples;
      const trimmed = this.context.createBuffer(
        decoded.numberOfChannels,
        trimmedLength,
        decoded.sampleRate,
      );
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        trimmed.copyToChannel(decoded.getChannelData(ch).subarray(trimSamples), ch);
      }

      return trimmed;
    }

    return decoded;
  }

  private scheduleAvailable(): void {
    if (!this.playing) {
      return;
    }

    for (const chunk of this.pendingChunks) {
      if (this.scheduledChunks.has(chunk)) {
        continue;
      }

      const chunkEnd = chunk.startSeconds + chunk.buffer.duration;
      if (chunkEnd <= this.refPositionSeconds) {
        continue;
      }

      if (this.scheduledUntilSeconds >= this.refPositionSeconds + LOOKAHEAD_SECONDS) {
        break;
      }

      this.scheduleChunk(chunk);
    }
  }

  private scheduleChunk(chunk: DecodedChunk): void {
    const position = this.refPositionSeconds;
    const playOffset = Math.max(0, position - chunk.startSeconds);
    if (playOffset >= chunk.buffer.duration) {
      return;
    }

    const contextStart = this.refContextTime + Math.max(0, chunk.startSeconds - position);

    const gain = this.context.createGain();
    gain.gain.value = 1;
    gain.connect(this.outputGain);

    const src = this.context.createBufferSource();
    src.buffer = chunk.buffer;
    src.connect(gain);
    src.start(contextStart, playOffset);
    src.onended = (): void => {
      gain.disconnect();
      if (this.playing) {
        this.scheduleAvailable();
      }
    };

    this.scheduledChunks.add(chunk);
    this.scheduledSources.push({ node: src, gain, endSeconds: chunk.startSeconds + chunk.buffer.duration });
    this.scheduledUntilSeconds = Math.max(
      this.scheduledUntilSeconds,
      chunk.startSeconds + chunk.buffer.duration,
    );
  }

  private clearScheduled(): void {
    for (const s of this.scheduledSources) {
      try {
        s.node.stop();
      } catch {}

      s.gain.disconnect();
    }

    this.scheduledSources = [];
    this.scheduledChunks.clear();
    this.scheduledUntilSeconds = this.refPositionSeconds;
  }

  private async fetchRange(start: number, end: number): Promise<Uint8Array | null> {
    try {
      const response = await fetch(this.url, {
        headers: { Range: `bytes=${start}-${end}` },
      });
      if (!response.ok && response.status !== 206) {
        return null;
      }

      return new Uint8Array(await response.arrayBuffer());
    } catch {
      return null;
    }
  }
}
