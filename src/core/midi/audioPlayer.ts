import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";

const ANALYSER_FFT_SIZE = 256;
const ANALYSER_INTERVAL_MS = 1000 / 30;
const ANALYSER_GAIN = Math.pow(10, 10 / 20); // analyzer output boost
const ANALYSER_ATTACK = 0.9; // rise factor per tick at 50 Hz → fast but not instant
const ANALYSER_RELEASE = 0.97; // decay factor per tick at 50 Hz → ~1 s half-life

export default class AudioPlayer {
  private _sources: AudioBufferSourceNode[] = [];
  private _soundtouchNode: SoundTouchNode;
  private _gainNodes: GainNode[];
  private _analysers: AnalyserNode[];
  private _analyserBuffers: Float32Array<ArrayBuffer>[];

  private _gainValues: number[];
  private _smoothedAmplitudes: number[];
  private _amplitudeInterval: ReturnType<typeof setInterval> | null = null;
  private _tempoValue = 1;
  private _pitchValue = 0;

  private _refContextTime = 0;
  private _refPosition = 0;
  private _playing = false;

  static async register(context: AudioContext): Promise<void> {
    await SoundTouchNode.register(context, processorUrl);
  }

  constructor(
    private _context: AudioContext,
    private _buffers: AudioBuffer[],
    onAmplitudes: (amplitudes: number[]) => void,
  ) {
    this._soundtouchNode = new SoundTouchNode(_context);
    this._gainNodes = _buffers.map(() => _context.createGain());
    this._gainValues = _buffers.map(() => 1);
    this._smoothedAmplitudes = _buffers.map(() => 0);

    this._analysers = _buffers.map(() => {
      const a = _context.createAnalyser();
      a.fftSize = ANALYSER_FFT_SIZE;
      a.smoothingTimeConstant = 0.8;
      return a;
    });
    this._analyserBuffers = this._analysers.map(a => new Float32Array(a.fftSize) as Float32Array<ArrayBuffer>);

    // GainNode[i] → AnalyserNode[i] → SoundTouchNode (shared) → destination (via connect())
    _buffers.forEach((_, i) => {
      this._gainNodes[i]!.connect(this._analysers[i]!);
      this._analysers[i]!.connect(this._soundtouchNode);
    });

    this._amplitudeInterval = setInterval(() => {
      onAmplitudes(this._computeAmplitudes());
    }, ANALYSER_INTERVAL_MS);
  }

  dispose(): void {
    if (this._amplitudeInterval !== null) {
      clearInterval(this._amplitudeInterval);
      this._amplitudeInterval = null;
    }
  }

  private _computeAmplitudes(): number[] {
    return this._analysers.map((analyser, i) => {
      analyser.getFloatTimeDomainData(this._analyserBuffers[i]!);
      const buf = this._analyserBuffers[i]!;
      let sum = 0;
      for (let s = 0; s < buf.length; s++) {
        sum += buf[s]! * buf[s]!;
      }

      const rms = Math.sqrt(sum / buf.length) * ANALYSER_GAIN;
      const prev = this._smoothedAmplitudes[i]!;
      const smoothed = rms > prev
        ? prev + (rms - prev) * ANALYSER_ATTACK // lerp toward peak
        : prev * ANALYSER_RELEASE; // multiplicative decay
      this._smoothedAmplitudes[i] = smoothed;
      return Math.min(1, smoothed);
    });
  }

  get position(): number {
    if (this._playing) {
      // source advances at _tempoValue × wall-clock rate
      return this._refPosition + (this._context.currentTime - this._refContextTime) * this._tempoValue;
    }

    return this._refPosition;
  }

  setGain(trackIndex: number, gain: number): void {
    if (this._gainValues[trackIndex] === gain) {
      return;
    }

    this._gainValues[trackIndex] = gain;
    this._gainNodes[trackIndex]?.gain.setTargetAtTime(gain, this._context.currentTime, 0.02);
  }

  setTempo(tempo: number): void {
    if (this._tempoValue === tempo) {
      return;
    }

    if (this._playing) {
      // snapshot position before the rate changes
      this._refPosition = this.position;
      this._refContextTime = this._context.currentTime;
    }

    this._tempoValue = tempo;

    for (const src of this._sources) {
      src.playbackRate.value = tempo;
    }

    this._applyPitch();
  }

  setPitch(semitones: number): void {
    if (this._pitchValue === semitones) {
      return;
    }

    this._pitchValue = semitones;
    this._applyPitch();
  }

  // Combine user semitone shift with compensation for BufferSource.playbackRate pitch change.
  private _applyPitch(): void {
    const semitones = this._pitchValue - 12 * Math.log2(this._tempoValue);
    this._soundtouchNode.pitchSemitones.value = semitones;
  }

  play(): void {
    if (this._playing) {
      return;
    }

    this._refContextTime = this._context.currentTime;
    this._sources = this._buffers.map((buffer, i) => {
      const src = this._context.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = this._tempoValue;
      src.connect(this._gainNodes[i]!);
      src.start(0, this._refPosition);
      return src;
    });
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) {
      return;
    }

    this._refPosition = this.position;
    this._sources.forEach(s => s.stop());
    this._sources = [];
    this._playing = false;
    this._smoothedAmplitudes.fill(0);
  }

  seek(seconds: number): void {
    const wasPlaying = this._playing;
    if (wasPlaying) {
      this.pause();
    }

    this._refPosition = seconds;
    if (wasPlaying) {
      this.play();
    }
  }

  connect(destination: AudioNode): void {
    this._soundtouchNode.connect(destination);
  }
}
