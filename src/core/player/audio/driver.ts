import type { RubberBandNode } from "rubberband-web";
import { createRubberBandNode } from "rubberband-web";

import type AudioClock from "../audioClock";
import type { AudioChunk } from "./chunkDetector";

// Processor is served from public/, where the postinstall script copies it.
// BASE_URL handles deployments at subpaths correctly.
const processorUrl = `${import.meta.env.BASE_URL}rubberband-processor.js`;

const ANALYSER_FFT_SIZE = 256;
const ANALYSER_INTERVAL_MS = 1000 / 30;
const ANALYSER_GAIN = Math.pow(10, 10 / 20);
const ANALYSER_ATTACK = 0.9;
const ANALYSER_RELEASE = 0.97;

// Bridges render-quantum gaps: old sources fade out, new ones fade in over this window.
const CROSSFADE = 0.02;
// Longer than the main thread stalls on slow phones, so a jump is scheduled before the recording reaches it.
const JUMP_LOOKAHEAD = 0.3;

export type TrackOptions = {
  highPassFilter?: boolean;
  compressor?: boolean;
};

export type AudioDriverOptions = {
  tracks: TrackOptions[];
  onAmplitudes: (amplitudes: number[]) => void;
};

/** A linear gain ramp over `CROSSFADE`, kept so a fade cut short continues from the value it reached. */
type Fade = { start: number; from: number; to: number };

/**
 * One continuous run through the recording: the sources of every track from `position` on, starting at
 * context time `start`. Seeks, jumps and tempo changes replace the playing segment with a new one.
 */
type Segment = {
  position: number;
  start: number;
  tempo: number;
  fadeGains: GainNode[];
  sources: (AudioBufferSourceNode | undefined)[];
  fade: Fade;
  stopTime?: number;
};

/** A jump scheduled ahead: `segment` takes over at its start, where the playing segment reaches `from`. */
type PendingJump = { from: number; to: number; segment: Segment; restoreFade: Fade };

const FULL_GAIN: Fade = { start: 0, from: 1, to: 1 };

function getFadeValue(fade: Fade, time: number): number {
  const progress = Math.min(1, Math.max(0, (time - fade.start) / CROSSFADE));
  return fade.from + (fade.to - fade.from) * progress;
}

function getChunkStart(chunk: AudioChunk): number {
  return chunk.sampleOffset / chunk.audioBuffer.sampleRate;
}

export default class AudioDriver {
  private rubberBandNode: RubberBandNode;
  private trackInputs: AudioNode[];
  private gainNodes: GainNode[];
  private gainValues: number[];
  private analysers: AnalyserNode[];
  private analyserBuffers: Float32Array<ArrayBuffer>[];
  private keepAlive: ConstantSourceNode;

  private smoothedAmplitudes: number[];
  private amplitudeInterval: ReturnType<typeof setInterval> | null = null;

  private tempoValue = 1;
  private pitchValue = 0;
  private pausedPosition = 0;
  private current: Segment | undefined = undefined;
  private pendingJump: PendingJump | undefined = undefined;

  static async create(
    context: AudioContext,
    clock: AudioClock,
    trackChunks: AudioChunk[][],
    options: AudioDriverOptions,
  ): Promise<AudioDriver> {
    const rubberBandNode = await createRubberBandNode(context, processorUrl, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return new AudioDriver(context, clock, trackChunks, options, rubberBandNode);
  }

  private constructor(
    private context: AudioContext,
    private clock: AudioClock,
    private trackChunks: AudioChunk[][],
    options: AudioDriverOptions,
    rubberBandNode: RubberBandNode,
  ) {
    this.rubberBandNode = rubberBandNode;
    const trackCount = trackChunks.length;

    this.gainNodes = Array.from({ length: trackCount }, () => context.createGain());
    this.gainValues = Array.from({ length: trackCount }, () => 0.7);
    this.smoothedAmplitudes = Array.from({ length: trackCount }, () => 0);

    this.analysers = Array.from({ length: trackCount }, () => {
      const a = context.createAnalyser();
      a.fftSize = ANALYSER_FFT_SIZE;
      a.smoothingTimeConstant = 0.8;
      return a;
    });
    this.analyserBuffers = this.analysers.map(
      a => new Float32Array(a.fftSize) as Float32Array<ArrayBuffer>,
    );

    this.trackInputs = Array.from({ length: trackCount }, (_, i) => {
      const opts = options.tracks[i];
      if (opts?.highPassFilter) {
        const hpf = context.createBiquadFilter();
        hpf.type = "highpass";
        hpf.frequency.value = 100;
        hpf.connect(this.gainNodes[i]!);
        return hpf;
      }

      return this.gainNodes[i]!;
    });

    const stereoBus = context.createGain();
    stereoBus.channelCount = 2;
    stereoBus.channelCountMode = "explicit";
    stereoBus.channelInterpretation = "speakers";

    this.keepAlive = context.createConstantSource();
    this.keepAlive.offset.value = 0;
    this.keepAlive.start();
    this.keepAlive.connect(stereoBus);

    stereoBus.connect(this.rubberBandNode);

    for (let i = 0; i < trackCount; i++) {
      const opts = options.tracks[i];
      let node: AudioNode = this.gainNodes[i]!;

      if (opts?.compressor) {
        const c = context.createDynamicsCompressor();
        c.threshold.value = -12;
        c.knee.value = 1.7;
        c.ratio.value = 2.0;
        c.attack.value = 0.01;
        c.release.value = 0.2;
        node.connect(c);
        node = c;
      }

      node.connect(this.analysers[i]!);
      this.analysers[i]!.connect(stereoBus);
    }

    this.amplitudeInterval = setInterval(() => {
      options.onAmplitudes(this.computeAmplitudes());
    }, ANALYSER_INTERVAL_MS);
  }

  dispose(): void {
    if (this.amplitudeInterval !== null) {
      clearInterval(this.amplitudeInterval);
      this.amplitudeInterval = null;
    }

    this.stopPlayback();
    this.keepAlive.stop();
    this.rubberBandNode.close();
  }

  /** The recording time being played, in seconds. Before a scheduled jump it runs on past the jump's start. */
  getPosition(): number {
    return this.current ? this.getSegmentPosition(this.current, this.clock.now()) : this.pausedPosition;
  }

  setGain(trackIndex: number, gain: number): void {
    if (this.gainValues[trackIndex] === gain) {
      return;
    }

    this.gainValues[trackIndex] = gain;
    this.gainNodes[trackIndex]?.gain.setTargetAtTime(gain, this.context.currentTime, 0.02);
  }

  setTempo(tempo: number): void {
    if (this.tempoValue === tempo) {
      return;
    }

    const position = this.getPosition();
    this.tempoValue = tempo;
    this.applyPitch();

    if (this.current) {
      this.cancelJump();
      this.crossfadeTo(position);
    }
  }

  setPitch(semitones: number): void {
    if (this.pitchValue === semitones) {
      return;
    }

    this.pitchValue = semitones;
    this.applyPitch();
  }

  play(): void {
    if (this.current) {
      return;
    }

    this.current = this.startSegment(this.pausedPosition, this.clock.now(), FULL_GAIN);
  }

  pause(): void {
    if (!this.current) {
      return;
    }

    this.pausedPosition = this.getPosition();
    this.stopPlayback();
    this.smoothedAmplitudes.fill(0);
  }

  /** Moves playback to `seconds` at once, cutting hard (user seeks). */
  seek(seconds: number): void {
    const wasPlaying = !!this.current;
    this.pause();
    this.pausedPosition = seconds;
    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Schedules a jump from recording time `from` to `to` for the moment playback reaches `from`, once that is
   * within the lookahead. A different jump replaces it. Announcing the next jump early makes it land exactly
   * where the recording reaches it, however late the main thread notices.
   */
  prepareJump(from: number, to: number): void {
    const segment = this.current;
    if (!segment || this.getSegmentTime(segment, from) - this.clock.now() > JUMP_LOOKAHEAD) {
      this.cancelJump();
      return;
    }

    this.scheduleJump(from, to);
  }

  /** Drops the jump scheduled by `prepareJump()`, so playback runs on. */
  cancelJump(): void {
    const pending = this.pendingJump;
    const segment = this.current;
    if (!pending || !segment) {
      return;
    }

    this.pendingJump = undefined;
    const { start } = pending.segment;
    if (start > this.context.currentTime) {
      this.stopSegment(pending.segment, this.clock.now());
      this.restoreFade(segment, pending.restoreFade, start);
      return;
    }

    // The crossfade is already being rendered, so playback fades back to where the playing segment is.
    const now = this.clock.now();
    this.retireSegment(pending.segment, now);
    this.crossfadeTo(this.getSegmentPosition(segment, now));
  }

  /** Jumps from recording time `from` to `to` (route jumps), as prepared or, if the jump came late, at once. */
  jump(from: number, to: number): void {
    if (!this.current) {
      this.pausedPosition = to;
      return;
    }

    const pending = this.scheduleJump(from, to);
    this.pendingJump = undefined;
    this.stopSegment(this.current, pending.segment.start + CROSSFADE);
    this.current = pending.segment;
  }

  connect(destination: AudioNode): void {
    this.rubberBandNode.connect(destination);
  }

  private scheduleJump(from: number, to: number): PendingJump {
    const pending = this.pendingJump;
    if (pending?.from === from && pending.to === to) {
      return pending;
    }

    this.cancelJump();
    const segment = this.current!;
    const start = Math.max(this.getSegmentTime(segment, from), this.clock.now());
    const restoreFade = segment.fade;
    this.fadeOut(segment, start);
    this.pendingJump = { from, to, segment: this.startSegment(to, start, { start, from: 0, to: 1 }), restoreFade };
    return this.pendingJump;
  }

  private crossfadeTo(position: number): void {
    const now = this.clock.now();
    this.retireSegment(this.current!, now);
    this.current = this.startSegment(position, now, { start: now, from: 0, to: 1 });
  }

  private stopPlayback(): void {
    const now = this.context.currentTime;
    if (this.pendingJump) {
      this.stopSegment(this.pendingJump.segment, now);
      this.pendingJump = undefined;
    }

    if (this.current) {
      this.stopSegment(this.current, now);
      this.current = undefined;
    }
  }

  private getSegmentPosition(segment: Segment, time: number): number {
    return segment.position + Math.max(0, time - segment.start) * segment.tempo;
  }

  private getSegmentTime(segment: Segment, position: number): number {
    return segment.start + (position - segment.position) / segment.tempo;
  }

  private startSegment(position: number, start: number, fade: Fade): Segment {
    const segment: Segment = {
      position,
      start,
      tempo: this.tempoValue,
      fadeGains: this.trackChunks.map((_, i) => {
        const gain = this.context.createGain();
        gain.gain.setValueAtTime(fade.from, start);
        gain.gain.linearRampToValueAtTime(fade.to, start + CROSSFADE);
        gain.connect(this.trackInputs[i]!);
        return gain;
      }),
      sources: this.trackChunks.map(() => undefined),
      fade,
    };

    this.trackChunks.forEach((chunks, track) => {
      const index = chunks.findIndex(chunk => position < getChunkStart(chunk) + chunk.audioBuffer.duration);
      if (index === -1) {
        segment.fadeGains[track]!.disconnect();
        return;
      }

      this.startChunk(segment, track, index);
    });

    return segment;
  }

  /** Starts a chunk where the segment reaches it, or at once and further in if the segment already passed its start. */
  private startChunk(segment: Segment, track: number, index: number): void {
    const chunk = this.trackChunks[track]![index]!;
    const when = this.getSegmentTime(segment, getChunkStart(chunk));
    const start = Math.max(when, segment.start, this.context.currentTime);
    const source = this.context.createBufferSource();
    source.buffer = chunk.audioBuffer;
    source.playbackRate.value = segment.tempo;
    source.connect(segment.fadeGains[track]!);
    source.start(start, (start - when) * segment.tempo);
    if (segment.stopTime !== undefined) {
      source.stop(segment.stopTime);
    }

    source.onended = () => this.onChunkEnded(segment, track, index);
    segment.sources[track] = source;
  }

  private onChunkEnded(segment: Segment, track: number, index: number): void {
    const next = this.trackChunks[track]![index + 1];
    const stopped = segment.stopTime !== undefined;
    if (!next || (stopped && this.getSegmentTime(segment, getChunkStart(next)) >= segment.stopTime!)) {
      segment.sources[track] = undefined;
      segment.fadeGains[track]!.disconnect();
      return;
    }

    this.startChunk(segment, track, index + 1);
  }

  /** Ramps the segment's gains to silence from `time`, continuing from wherever an earlier fade got to. */
  private fadeOut(segment: Segment, time: number): void {
    const from = getFadeValue(segment.fade, time);
    segment.fadeGains.forEach((gain) => {
      gain.gain.cancelScheduledValues(time);
      gain.gain.setValueAtTime(from, time);
      gain.gain.linearRampToValueAtTime(0, time + CROSSFADE);
    });
    segment.fade = { start: time, from, to: 0 };
  }

  /** Takes back a fade scheduled from `time` on, finishing the fade the segment had before. */
  private restoreFade(segment: Segment, fade: Fade, time: number): void {
    segment.fadeGains.forEach((gain) => {
      gain.gain.cancelScheduledValues(time);
      gain.gain.linearRampToValueAtTime(fade.to, Math.max(time, fade.start + CROSSFADE));
    });
    segment.fade = fade;
  }

  private retireSegment(segment: Segment, time: number): void {
    this.fadeOut(segment, time);
    this.stopSegment(segment, time + CROSSFADE);
  }

  /** Stops every source of the segment at `time`. Each source is stopped once, since Safari throws on a second stop(). */
  private stopSegment(segment: Segment, time: number): void {
    if (segment.stopTime !== undefined) {
      return;
    }

    segment.stopTime = time;
    segment.sources.forEach((source) => {
      try {
        source?.stop(time);
      } catch {}
    });
  }

  private applyPitch(): void {
    const semitones = this.pitchValue - 12 * Math.log2(this.tempoValue);
    this.rubberBandNode.setPitch(Math.pow(2, semitones / 12));
  }

  private computeAmplitudes(): number[] {
    return this.analysers.map((analyser, i) => {
      analyser.getFloatTimeDomainData(this.analyserBuffers[i]!);
      const buf = this.analyserBuffers[i]!;
      let sum = 0;
      for (let s = 0; s < buf.length; s++) {
        sum += buf[s]! * buf[s]!;
      }

      const rms = Math.sqrt(sum / buf.length) * ANALYSER_GAIN;
      const prev = this.smoothedAmplitudes[i]!;
      const smoothed
        = rms > prev ? prev + (rms - prev) * ANALYSER_ATTACK : prev * ANALYSER_RELEASE;
      this.smoothedAmplitudes[i] = smoothed;
      return Math.min(1, smoothed);
    });
  }
}
