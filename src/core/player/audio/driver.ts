import type { RubberBandNode } from "rubberband-web";
import { createRubberBandNode } from "rubberband-web";

// Processor is served from public/ — copied there by the postinstall script.
// BASE_URL handles deployments at subpaths correctly.
const processorUrl = `${import.meta.env.BASE_URL}rubberband-processor.js`;

const ANALYSER_FFT_SIZE = 256;
const ANALYSER_INTERVAL_MS = 1000 / 30;
const ANALYSER_GAIN = Math.pow(10, 10 / 20);
const ANALYSER_ATTACK = 0.9;
const ANALYSER_RELEASE = 0.97;

// Matches MIDI's AUDIO_CLOCK_OFFSET: old sources drain for this long before new ones start.
const AUDIO_LOOKAHEAD = 0.1;

export type TrackOptions = {
  highPassFilter?: boolean;
  compressor?: boolean;
};

export type AudioDriverOptions = {
  tracks: TrackOptions[];
  onAmplitudes: (amplitudes: number[]) => void;
};

export default class AudioDriver {
  private sources: AudioBufferSourceNode[] = [];
  private rubberBandNode: RubberBandNode;
  private trackInputs: AudioNode[];
  private gainNodes: GainNode[];
  private analysers: AnalyserNode[];
  private analyserBuffers: Float32Array<ArrayBuffer>[];
  private keepAlive: ConstantSourceNode;

  private gainValues: number[];
  private smoothedAmplitudes: number[];
  private amplitudeInterval: ReturnType<typeof setInterval> | null = null;
  private tempoValue = 1;
  private pitchValue = 0;

  // When the current sources start (or started) playing in AudioContext time.
  // For immediate starts this equals the play() call time; for scheduled seeks it is in the future.
  private scheduledStartTime = 0;
  private refPosition = 0;
  private playing = false;

  static async create(
    context: AudioContext,
    buffers: AudioBuffer[],
    options: AudioDriverOptions,
  ): Promise<AudioDriver> {
    const rubberBandNode = await createRubberBandNode(context, processorUrl, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    return new AudioDriver(context, buffers, options, rubberBandNode);
  }

  private constructor(
    private context: AudioContext,
    private buffers: AudioBuffer[],
    options: AudioDriverOptions,
    rubberBandNode: RubberBandNode,
  ) {
    this.rubberBandNode = rubberBandNode;
    this.gainNodes = buffers.map(() => context.createGain());
    this.gainValues = buffers.map(() => 0.7);
    this.smoothedAmplitudes = buffers.map(() => 0);

    this.analysers = buffers.map(() => {
      const a = context.createAnalyser();
      a.fftSize = ANALYSER_FFT_SIZE;
      a.smoothingTimeConstant = 0.8;
      return a;
    });
    this.analyserBuffers = this.analysers.map(a => new Float32Array(a.fftSize) as Float32Array<ArrayBuffer>);

    // Per-track chain: [HighPassFilter →] GainNode → [Compressor →] AnalyserNode → RubberBandNode (shared)
    this.trackInputs = buffers.map((_, i) => {
      const trackOpts = options.tracks[i];

      if (trackOpts?.highPassFilter) {
        const hpf = context.createBiquadFilter();
        hpf.type = "highpass";
        hpf.frequency.value = 100;
        hpf.connect(this.gainNodes[i]!);
        return hpf;
      }

      return this.gainNodes[i]!;
    });

    // A ConstantSourceNode (offset=0, silent) keeps the stereo bus permanently active
    // so rubberband's AudioWorklet always receives a properly-formatted 2-channel input.
    // Without this, Edge passes inputs[0]=[] once all sources stop, causing rubberband
    // to crash with "Invalid channel index 1".
    const stereoBus = context.createGain();
    stereoBus.channelCount = 2;
    stereoBus.channelCountMode = "explicit";
    stereoBus.channelInterpretation = "speakers";

    this.keepAlive = context.createConstantSource();
    this.keepAlive.offset.value = 0;
    this.keepAlive.start();
    this.keepAlive.connect(stereoBus);

    stereoBus.connect(this.rubberBandNode);

    buffers.forEach((_, i) => {
      const trackOpts = options.tracks[i];
      let node: AudioNode = this.gainNodes[i]!;

      if (trackOpts?.compressor) {
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
    });

    this.amplitudeInterval = setInterval(() => {
      options.onAmplitudes(this.computeAmplitudes());
    }, ANALYSER_INTERVAL_MS);
  }

  dispose(): void {
    if (this.amplitudeInterval !== null) {
      clearInterval(this.amplitudeInterval);
      this.amplitudeInterval = null;
    }

    this.keepAlive.stop();
    this.rubberBandNode.close();
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
      const smoothed = rms > prev
        ? prev + (rms - prev) * ANALYSER_ATTACK
        : prev * ANALYSER_RELEASE;
      this.smoothedAmplitudes[i] = smoothed;
      return Math.min(1, smoothed);
    });
  }

  getPosition(): number {
    if (this.playing) {
      // Clamp to zero during a lookahead window (scheduledStartTime is in the future).
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
      // Only reanchor when past the lookahead window. If a scheduled seek is pending
      // (scheduledStartTime is in the future), refPosition and scheduledStartTime already
      // define the correct upcoming start — just update the rate.
      if (this.context.currentTime >= this.scheduledStartTime) {
        this.refPosition = this.getPosition();
        this.scheduledStartTime = this.context.currentTime;
      }
    }

    this.tempoValue = tempo;

    for (const src of this.sources) {
      src.playbackRate.value = tempo;
    }

    this.applyPitch();
  }

  setPitch(semitones: number): void {
    if (this.pitchValue === semitones) {
      return;
    }

    this.pitchValue = semitones;
    this.applyPitch();
  }

  // Combines user semitone shift with compensation for BufferSource.playbackRate pitch change.
  private applyPitch(): void {
    const semitones = this.pitchValue - 12 * Math.log2(this.tempoValue);
    this.rubberBandNode.setPitch(Math.pow(2, semitones / 12));
  }

  play(): void {
    if (this.playing) {
      return;
    }

    this.scheduledStartTime = this.context.currentTime;
    this.sources = this.buffers.map((buffer, i) => {
      const src = this.context.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = this.tempoValue;
      src.connect(this.trackInputs[i]!);
      src.start(0, this.refPosition);
      return src;
    });
    this.playing = true;
  }

  pause(): void {
    if (!this.playing) {
      return;
    }

    this.refPosition = this.getPosition();
    // Sources scheduled for a future start (lookahead window) may throw on stop() in some
    // environments. Use try-catch; in real browsers this is always safe.
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {}
    });
    this.sources = [];
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

  /**
   * Schedule a seamless seek to `positionSeconds` at `AUDIO_LOOKAHEAD` seconds in the future.
   * Current sources drain until the scheduled time; new sources start from the new position
   * at the same audio frame — no gap, no overlap.
   */
  scheduleSeek(positionSeconds: number): void {
    if (!this.playing) {
      this.refPosition = positionSeconds;
      return;
    }

    const when = this.context.currentTime + AUDIO_LOOKAHEAD;

    // Schedule current sources to stop at the jump time; release our reference so they GC
    // once they stop. Any tail audio (up to AUDIO_LOOKAHEAD seconds) is intentional —
    // it mirrors the behaviour of MIDI's AUDIO_CLOCK_OFFSET lookahead.
    this.sources.forEach(s => s.stop(when));

    // New sources start from the new position at the same audio time.
    this.refPosition = positionSeconds;
    this.scheduledStartTime = when;
    this.sources = this.buffers.map((buffer, i) => {
      const src = this.context.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = this.tempoValue;
      src.connect(this.trackInputs[i]!);
      src.start(when, positionSeconds);
      return src;
    });
  }

  connect(destination: AudioNode): void {
    this.rubberBandNode.connect(destination);
  }
}
