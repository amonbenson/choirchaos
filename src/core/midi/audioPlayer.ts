import { SoundTouchNode } from "@soundtouchjs/audio-worklet";
import processorUrl from "@soundtouchjs/audio-worklet/processor?url";

export default class AudioPlayer {
  private _sources: AudioBufferSourceNode[] = [];
  private _soundtouchNodes: SoundTouchNode[];
  private _gainNodes: GainNode[];

  private _gainValues: number[];
  private _tempoValue = 1;
  private _pitchValue = 0;

  private _refContextTime = 0;
  private _refPosition = 0;
  private _playing = false;

  static async register(context: AudioContext): Promise<void> {
    await SoundTouchNode.register(context, processorUrl);
  }

  constructor(private _context: AudioContext, private _buffers: AudioBuffer[]) {
    this._soundtouchNodes = _buffers.map(() => new SoundTouchNode(_context));

    this._gainNodes = _buffers.map(() => _context.createGain());
    this._gainValues = _buffers.map(() => 1);

    _buffers.forEach((_, i) => {
      const c = _context.createDynamicsCompressor();
      c.threshold.value = -4;
      c.knee.value = 2;
      c.ratio.value = 1.5;
      c.attack.value = 0.001;
      c.release.value = 0.1;
      // SoundTouchNode → DynamicsCompressor → GainNode
      this._soundtouchNodes[i]!.connect(c);
      c.connect(this._gainNodes[i]!);
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
    for (const node of this._soundtouchNodes) {
      node.pitchSemitones.value = semitones;
    }
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
      src.connect(this._soundtouchNodes[i]!);
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
    this._gainNodes.forEach(g => g.connect(destination));
  }
}
