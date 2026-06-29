import type { RubberBandNode } from "rubberband-web";
import { createRubberBandNode } from "rubberband-web";

import type { AudioChunk } from "./chunkDetector";
import type { AudioDriverOptions } from "./driver";

const processorUrl = `${import.meta.env.BASE_URL}rubberband-processor.js`;

const ANALYSER_FFT_SIZE = 256;
const ANALYSER_INTERVAL_MS = 1000 / 30;
const ANALYSER_GAIN = Math.pow(10, 10 / 20);
const ANALYSER_ATTACK = 0.9;
const ANALYSER_RELEASE = 0.97;

const AUDIO_LOOKAHEAD = 0.1;
const SEEK_CROSSFADE = 0.02;

export default class ChunkedAudioPlayer {
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
  private scheduledStartTime = 0;
  private refPosition = 0;
  private playing = false;
  private generation = 0;

  private activeSources: (AudioBufferSourceNode | null)[] = [];
  private sourceFadeGains: GainNode[] = [];

  static async create(
    context: AudioContext,
    trackChunks: AudioChunk[][],
    options: AudioDriverOptions,
  ): Promise<ChunkedAudioPlayer> {
    const rubberBandNode = await createRubberBandNode(context, processorUrl, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return new ChunkedAudioPlayer(context, trackChunks, options, rubberBandNode);
  }

  private constructor(
    private context: AudioContext,
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

    this.generation++;
    this.activeSources.forEach((src) => {
      if (!src) {
        return;
      }

      try {
        src.stop();
      } catch {}
    });
    this.keepAlive.stop();
    this.rubberBandNode.close();
  }

  getPosition(): number {
    if (this.playing) {
      const elapsed = Math.max(0, this.context.currentTime - this.scheduledStartTime);
      return this.refPosition + elapsed * this.tempoValue;
    }

    return this.refPosition;
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

    if (this.playing) {
      this.refPosition = this.getPosition();
      this.scheduledStartTime = this.context.currentTime;
    }

    this.tempoValue = tempo;
    this.applyPitch();

    if (this.playing) {
      this.crossfadeToPosition(this.refPosition, 0);
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
    if (this.playing) {
      return;
    }

    this.scheduledStartTime = this.context.currentTime;
    this.generation++;
    const gen = this.generation;

    this.activeSources = new Array(this.trackChunks.length).fill(null);
    this.sourceFadeGains = this.trackChunks.map((_, i) => {
      const g = this.context.createGain();
      g.gain.value = 1;
      g.connect(this.trackInputs[i]!);
      return g;
    });

    for (let i = 0; i < this.trackChunks.length; i++) {
      this.scheduleTrackFrom(i, this.refPosition, this.context.currentTime, this.sourceFadeGains[i]!, gen);
    }

    this.playing = true;
  }

  pause(): void {
    if (!this.playing) {
      return;
    }

    this.refPosition = this.getPosition();
    this.generation++;

    this.activeSources.forEach((src) => {
      if (!src) {
        return;
      }

      try {
        src.stop();
      } catch {}
    });
    this.activeSources = [];
    this.sourceFadeGains.forEach(g => g.disconnect());
    this.sourceFadeGains = [];
    this.playing = false;
    this.smoothedAmplitudes.fill(0);
  }

  seek(seconds: number): void {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.pause();
    }

    this.refPosition = seconds;
    if (wasPlaying) {
      this.play();
    }
  }

  scheduleSeek(positionSeconds: number, lookahead = AUDIO_LOOKAHEAD): void {
    if (!this.playing) {
      this.refPosition = positionSeconds;
      return;
    }

    this.crossfadeToPosition(positionSeconds, lookahead);
  }

  connect(destination: AudioNode): void {
    this.rubberBandNode.connect(destination);
  }

  private crossfadeToPosition(positionSeconds: number, lookahead: number): void {
    const when = this.context.currentTime + lookahead;
    const xfadeEnd = when + SEEK_CROSSFADE;

    const oldFadeGains = this.sourceFadeGains;
    const oldSources = this.activeSources;

    oldFadeGains.forEach((g) => {
      g.gain.setValueAtTime(1, when);
      g.gain.linearRampToValueAtTime(0, xfadeEnd);
    });
    oldSources.forEach((src, i) => {
      if (!src) {
        return;
      }

      src.onended = () => oldFadeGains[i]?.disconnect();
      try {
        src.stop(xfadeEnd);
      } catch {}
    });

    this.generation++;
    const gen = this.generation;

    this.activeSources = new Array(this.trackChunks.length).fill(null);
    this.sourceFadeGains = this.trackChunks.map((_, i) => {
      const g = this.context.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, xfadeEnd);
      g.connect(this.trackInputs[i]!);
      return g;
    });

    for (let i = 0; i < this.trackChunks.length; i++) {
      this.scheduleTrackFrom(i, positionSeconds, when, this.sourceFadeGains[i]!, gen);
    }

    this.refPosition = positionSeconds;
    this.scheduledStartTime = when;
  }

  private scheduleTrackFrom(
    trackIndex: number,
    positionSeconds: number,
    when: number,
    fadeGain: GainNode,
    gen: number,
  ): void {
    const chunks = this.trackChunks[trackIndex]!;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const chunkStart = chunk.sampleOffset / chunk.audioBuffer.sampleRate;
      const chunkEnd = chunkStart + chunk.audioBuffer.duration;

      if (positionSeconds >= chunkStart && positionSeconds < chunkEnd) {
        const offsetInChunk = positionSeconds - chunkStart;
        const src = this.createSource(chunk.audioBuffer, fadeGain);
        src.start(when, offsetInChunk);
        this.activeSources[trackIndex] = src;
        src.onended = () => this.scheduleNextChunk(trackIndex, i, fadeGain, gen);
        return;
      }

      if (positionSeconds < chunkStart) {
        const timeToChunk = (chunkStart - positionSeconds) / this.tempoValue;
        const src = this.createSource(chunk.audioBuffer, fadeGain);
        src.start(when + timeToChunk, 0);
        this.activeSources[trackIndex] = src;
        src.onended = () => this.scheduleNextChunk(trackIndex, i, fadeGain, gen);
        return;
      }
    }

    this.activeSources[trackIndex] = null;
  }

  private scheduleNextChunk(
    trackIndex: number,
    currentChunkIndex: number,
    fadeGain: GainNode,
    gen: number,
  ): void {
    if (this.generation !== gen) {
      return;
    }

    const chunks = this.trackChunks[trackIndex]!;
    const nextChunk = chunks[currentChunkIndex + 1];
    if (!nextChunk) {
      this.activeSources[trackIndex] = null;
      return;
    }

    const currentChunk = chunks[currentChunkIndex]!;
    const sr = currentChunk.audioBuffer.sampleRate;
    const currentChunkEnd = (currentChunk.sampleOffset + currentChunk.audioBuffer.length) / sr;
    const nextChunkStart = nextChunk.sampleOffset / nextChunk.audioBuffer.sampleRate;
    const silenceGap = nextChunkStart - currentChunkEnd;

    const when = this.context.currentTime;
    const src = this.createSource(nextChunk.audioBuffer, fadeGain);
    src.start(when + silenceGap / this.tempoValue, 0);
    this.activeSources[trackIndex] = src;
    src.onended = () => this.scheduleNextChunk(trackIndex, currentChunkIndex + 1, fadeGain, gen);
  }

  private createSource(audioBuffer: AudioBuffer, fadeGain: GainNode): AudioBufferSourceNode {
    const src = this.context.createBufferSource();
    src.buffer = audioBuffer;
    src.playbackRate.value = this.tempoValue;
    src.connect(fadeGain);
    return src;
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
